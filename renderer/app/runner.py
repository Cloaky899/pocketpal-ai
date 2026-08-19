from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .models import (
    Artifact,
    FailureCategory,
    RenderRequest,
    RenderResponse,
    RenderStatus,
    now_utc,
)
from .policy import ProgramPolicyError, validate_source

QUALITY_FLAGS = {"low": "-ql", "high": "-qh"}
ASPECT_CONFIG = {
    "16:9": "",
    "9:16": "[CLI]\npixel_width = 540\npixel_height = 960\nframe_width = 8.0\nframe_height = 14.222\n",
    "1:1": "[CLI]\npixel_width = 720\npixel_height = 720\nframe_width = 8.0\nframe_height = 8.0\n",
}


@dataclass
class JobRecord:
    response: RenderResponse
    request: RenderRequest
    workspace: Path
    task: asyncio.Task[None] | None = None
    process: asyncio.subprocess.Process | None = None
    cancelled: bool = False
    log_lines: list[str] = field(default_factory=list)


class RendererService:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, JobRecord] = {}
        self.lock = asyncio.Lock()

    async def submit(self, request: RenderRequest) -> RenderResponse:
        source = request.program.get("code")
        if not isinstance(source, str):
            raise ProgramPolicyError("program.code must be a string")
        policy = validate_source(source)
        job_id = uuid.uuid4().hex
        workspace = self.root / job_id
        workspace.mkdir(parents=True, mode=0o700)
        (workspace / "video.py").write_text(source, encoding="utf-8")
        aspect_config = ASPECT_CONFIG[request.options.aspect_ratio]
        if aspect_config:
            (workspace / "manim.cfg").write_text(aspect_config, encoding="utf-8")

        created = now_utc()
        response = RenderResponse(
            job_id=job_id,
            request_id=request.request_id,
            status=RenderStatus.queued,
            progress=0,
            created_at=created,
            updated_at=created,
        )
        record = JobRecord(response=response, request=request, workspace=workspace)
        async with self.lock:
            self.jobs[job_id] = record
        record.task = asyncio.create_task(self._run(record, policy.scene_names))
        return response

    async def get(self, job_id: str) -> RenderResponse:
        record = await self._get_record(job_id)
        return record.response

    async def cancel(self, job_id: str) -> None:
        record = await self._get_record(job_id)
        record.cancelled = True
        if record.process and record.process.returncode is None:
            record.process.terminate()
        if record.task and not record.task.done():
            await record.task

    async def artifacts(self, job_id: str) -> list[Artifact]:
        record = await self._get_record(job_id)
        return record.response.artifacts

    async def _get_record(self, job_id: str) -> JobRecord:
        async with self.lock:
            record = self.jobs.get(job_id)
        if record is None:
            raise KeyError(job_id)
        return record

    async def _run(self, record: JobRecord, scene_names: list[str]) -> None:
        try:
            await self._set_status(record, RenderStatus.rendering, 10)
            quality_flag = QUALITY_FLAGS[record.request.options.quality.value]
            media_dir = record.workspace / "media"
            media_dir.mkdir()
            for index, scene_name in enumerate(scene_names):
                if record.cancelled:
                    await self._finish_cancelled(record)
                    return
                await self._render_scene(record, scene_name, quality_flag, media_dir)
                progress = 10 + int(((index + 1) / len(scene_names)) * 65)
                await self._set_status(record, RenderStatus.rendering, progress)

            artifacts = await self._collect_artifacts(record, scene_names, media_dir)
            report = {
                "job_id": record.response.job_id,
                "request_id": record.response.request_id,
                "quality": record.request.options.quality.value,
                "scenes": scene_names,
                "artifacts": [artifact.model_dump(mode="json") for artifact in artifacts],
            }
            (record.workspace / "report.json").write_text(
                json.dumps(report, indent=2), encoding="utf-8"
            )
            artifacts.append(
                Artifact(
                    kind="logs",
                    name="report.json",
                    path="report.json",
                    mime_type="application/json",
                    size_bytes=(record.workspace / "report.json").stat().st_size,
                )
            )
            record.response.artifacts = artifacts
            await self._set_status(record, RenderStatus.completed, 100)
        except asyncio.CancelledError:
            await self._finish_cancelled(record)
        except asyncio.TimeoutError:
            await self._fail(record, FailureCategory.timeout, "render timed out")
        except ProgramPolicyError as exc:
            await self._fail(record, FailureCategory.policy, str(exc))
        except Exception as exc:  # noqa: BLE001 - convert worker failures to API status
            await self._fail(record, self._classify_error(str(exc)), self._sanitize_error(str(exc)))

    async def _render_scene(
        self,
        record: JobRecord,
        scene_name: str,
        quality_flag: str,
        media_dir: Path,
    ) -> None:
        command = [
            "manim",
            quality_flag,
            "--disable_caching",
            "--media_dir",
            str(media_dir),
            "video.py",
            scene_name,
        ]
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(record.workspace),
            "PYTHONNOUSERSITE": "1",
            "PYTHONUNBUFFERED": "1",
        }
        record.log_lines.append(f"rendering scene {scene_name}")
        record.process = await asyncio.create_subprocess_exec(
            *command,
            cwd=record.workspace,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            stdout, _ = await asyncio.wait_for(
                record.process.communicate(),
                timeout=record.request.options.timeout_seconds,
            )
        except asyncio.TimeoutError:
            record.process.kill()
            await record.process.communicate()
            raise
        output = stdout.decode("utf-8", errors="replace")
        record.log_lines.extend(output.splitlines()[-80:])
        if record.cancelled:
            raise asyncio.CancelledError
        if record.process.returncode != 0:
            tail = "\n".join(record.log_lines[-40:])
            raise RuntimeError(f"Manim failed for {scene_name}: {tail}")

    async def _collect_artifacts(
        self,
        record: JobRecord,
        scene_names: list[str],
        media_dir: Path,
    ) -> list[Artifact]:
        artifacts: list[Artifact] = []
        quality_folder = "480p15" if record.request.options.quality.value == "low" else "1080p60"
        for scene_name in scene_names:
            matches = list(media_dir.rglob(f"{scene_name}.mp4"))
            if not matches:
                raise RuntimeError(f"rendered video missing for scene {scene_name}")
            video = matches[0]
            frame = record.workspace / f"{scene_name}.png"
            await self._extract_frame(video, frame)
            artifacts.append(
                Artifact(
                    kind="preview-video" if record.request.options.quality.value == "low" else "final-video",
                    name=video.name,
                    path=str(video.relative_to(record.workspace)),
                    mime_type="video/mp4",
                    size_bytes=video.stat().st_size,
                )
            )
            if frame.exists():
                artifacts.append(
                    Artifact(
                        kind="frame",
                        name=frame.name,
                        path=frame.name,
                        mime_type="image/png",
                        size_bytes=frame.stat().st_size,
                    )
                )
        return artifacts

    async def _extract_frame(self, video: Path, frame: Path) -> None:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-sseof",
            "-1",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(frame),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(process.communicate(), timeout=30)
        if process.returncode != 0 or not frame.exists():
            raise RuntimeError(f"could not extract representative frame from {video.name}")

    async def _set_status(self, record: JobRecord, status: RenderStatus, progress: int) -> None:
        record.response.status = status
        record.response.progress = progress
        record.response.updated_at = now_utc()

    async def _fail(self, record: JobRecord, category: FailureCategory, message: str) -> None:
        record.response.failure_category = category
        record.response.error_message = message[-2_000:]
        await self._set_status(record, RenderStatus.failed, 100)
        log_path = record.workspace / "worker.log"
        log_path.write_text("\n".join(record.log_lines)[-20_000:], encoding="utf-8")
        record.response.artifacts = [
            Artifact(
                kind="logs",
                name=log_path.name,
                path=log_path.name,
                mime_type="text/plain",
                size_bytes=log_path.stat().st_size,
            )
        ]

    async def _finish_cancelled(self, record: JobRecord) -> None:
        record.response.failure_category = FailureCategory.cancelled
        record.response.error_message = "render cancelled"
        await self._set_status(record, RenderStatus.cancelled, 100)

    @staticmethod
    def _classify_error(message: str) -> FailureCategory:
        lowered = message.lower()
        if "timeout" in lowered or "timed out" in lowered:
            return FailureCategory.timeout
        if "missing" in lowered or "artifact" in lowered:
            return FailureCategory.artifact
        if "syntax" in lowered:
            return FailureCategory.syntax
        if "import" in lowered or "module" in lowered:
            return FailureCategory.dependency
        return FailureCategory.runtime

    @staticmethod
    def _sanitize_error(message: str) -> str:
        return message.replace("Authorization:", "Authorization: [redacted]")[-2_000:]

    async def cleanup(self, job_id: str) -> None:
        record = await self._get_record(job_id)
        if record.task and not record.task.done():
            record.task.cancel()
        shutil.rmtree(record.workspace, ignore_errors=True)
