from __future__ import annotations

import platform
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import FileResponse

from .models import HealthResponse, RenderRequest, RenderResponse, RenderStatus
from .policy import ProgramPolicyError
from .runner import RendererService

ROOT = Path(__file__).resolve().parents[1] / "workspaces"
service = RendererService(ROOT)
app = FastAPI(
    title="PocketPal Manim Renderer",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    manim_path = shutil.which("manim")
    ffmpeg_path = shutil.which("ffmpeg")
    return HealthResponse(
        healthy=manim_path is not None and ffmpeg_path is not None,
        renderer="manim-community-isolated",
        python_version=platform.python_version(),
        capabilities=[
            "manim-community-edition",
            "low-quality-preview",
            "high-quality-final",
            "representative-frames",
            "bounded-subprocesses",
        ],
    )


@app.post("/render-jobs", response_model=RenderResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_render_job(request: RenderRequest) -> RenderResponse:
    try:
        return await service.submit(request)
    except ProgramPolicyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="renderer workspace is unavailable") from exc


@app.get("/render-jobs/{job_id}", response_model=RenderResponse)
async def get_render_job(job_id: str) -> RenderResponse:
    try:
        return await service.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="render job not found") from exc


@app.post("/render-jobs/{job_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_render_job(job_id: str) -> Response:
    try:
        await service.cancel(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="render job not found") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/render-jobs/{job_id}/artifacts")
async def get_render_artifacts(job_id: str) -> list[dict]:
    try:
        artifacts = await service.artifacts(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="render job not found") from exc
    result: list[dict] = []
    record = await service._get_record(job_id)
    for artifact in artifacts:
        path = (record.workspace / artifact.path).resolve()
        if record.workspace.resolve() not in path.parents and path != record.workspace.resolve():
            raise HTTPException(status_code=500, detail="artifact path escaped workspace")
        if not path.is_file():
            continue
        result.append({"kind": artifact.kind, "name": artifact.name, "url": f"/render-jobs/{job_id}/artifacts/{artifact.name}"})
    return result


@app.get("/render-jobs/{job_id}/artifacts/{name}")
async def download_render_artifact(job_id: str, name: str) -> FileResponse:
    try:
        record = await service._get_record(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="render job not found") from exc
    candidate = (record.workspace / name).resolve()
    if record.workspace.resolve() not in candidate.parents or not candidate.is_file():
        raise HTTPException(status_code=404, detail="artifact not found")
    return FileResponse(candidate)
