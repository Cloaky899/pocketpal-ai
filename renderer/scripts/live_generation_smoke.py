#!/usr/bin/env python3
"""Generate a small ScenePlan and ManimProgram through an OpenAI-compatible API.

The script intentionally prints only sanitized test metadata. It never prints API
keys, authorization headers, raw prompts, model responses, or generated source.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from app.policy import ProgramPolicyError, validate_source

SYSTEM_PROMPT = """You are a bounded educational visualization agent.
Return JSON only. Use Manim Community Edition. Generate a short, deterministic,
legible 2D scene. Do not use files, network access, subprocess, os, pathlib,
shutil, eval, exec, __import__, or third-party packages beyond Manim and NumPy.
Every scene must have a visible Text title at the top, explicit animation timing,
and a final wait.
"""

SCENE_PLAN_PROMPT = """Create a ScenePlan JSON for this topic: visually explain a vector rotating
around the origin. Use exactly one scene, about 4 seconds, for a beginner audience.
Required keys: schemaVersion, requestId, title, summary, scenes, totalDurationSeconds.
Each scene requires sceneId, title, learningObjective, visualElements,
animationBeats, durationSeconds, and technicalNotes. technicalNotes must include
framework 'manim-ce', requiredImports ['manim'], and notes.
"""

PROGRAM_PROMPT = """Create a ManimProgram JSON from the supplied ScenePlan.
Required keys: schemaVersion, requestId, framework, entrypoint, sceneNames, code,
and imports. The framework must be 'manim-ce', entrypoint 'video.py', imports must
be ['manim'], and code must contain complete runnable Python with one Scene class.
Use only `from manim import *`. Do not include Markdown fences or prose.

ScenePlan:
"""


def api_base() -> str:
    return (os.environ.get("GENERATION_API_BASE") or os.environ.get("OPENAI_API_BASE") or "").rstrip("/")


def api_key() -> str:
    return os.environ.get("GENERATION_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""


def model_name() -> str:
    return os.environ.get("GENERATION_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-5-mini"


def request_completion(messages: list[dict[str, str]]) -> str:
    base = api_base()
    key = api_key()
    if not base or not key:
        raise RuntimeError("generation API credentials are not configured")
    body = json.dumps({"model": model_name(), "messages": messages, "temperature": 0.2}).encode()
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"generation API returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("generation API network request failed") from exc
    choices = payload.get("choices") or []
    content = choices[0].get("message", {}).get("content") if choices else None
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("generation API returned no message content")
    return content


def extract_json(content: str) -> dict:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError("model did not return a JSON object")
        value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise RuntimeError("model returned a non-object JSON value")
    return value


def main() -> int:
    plan = extract_json(
        request_completion([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": SCENE_PLAN_PROMPT},
        ])
    )
    required_plan_keys = {"schemaVersion", "requestId", "title", "summary", "scenes", "totalDurationSeconds"}
    if not required_plan_keys.issubset(plan):
        raise RuntimeError("model ScenePlan omitted required keys")

    program = extract_json(
        request_completion([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": PROGRAM_PROMPT + json.dumps(plan)},
        ])
    )
    required_program_keys = {"schemaVersion", "requestId", "framework", "entrypoint", "sceneNames", "code", "imports"}
    if not required_program_keys.issubset(program):
        raise RuntimeError("model ManimProgram omitted required keys")
    if program.get("framework") != "manim-ce":
        raise RuntimeError("model selected an unsupported Manim framework")
    source = program.get("code")
    if not isinstance(source, str):
        raise RuntimeError("model ManimProgram code is not a string")
    try:
        policy = validate_source(source)
    except ProgramPolicyError as exc:
        raise RuntimeError(f"generated program failed policy: {exc}") from exc

    with tempfile.TemporaryDirectory(prefix="pocketpal-generation-") as temp_dir:
        root = Path(temp_dir)
        source_path = root / "video.py"
        media_dir = root / "media"
        source_path.write_text(source, encoding="utf-8")
        for scene_name in policy.scene_names:
            result = subprocess.run(
                ["manim", "-ql", "--disable_caching", "--media_dir", str(media_dir), str(source_path), scene_name],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(f"generated scene failed to render: {scene_name}")
            videos = list(media_dir.rglob(f"{scene_name}.mp4"))
            if not videos or videos[0].stat().st_size == 0:
                raise RuntimeError(f"generated scene produced no MP4: {scene_name}")

    print(json.dumps({
        "ok": True,
        "provider": "configured-openai-compatible",
        "model": model_name(),
        "scene_count": len(policy.scene_names),
        "policy": "passed",
        "render": "passed",
    }))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 - keep CI output sanitized and concise
        print(json.dumps({"ok": False, "error": str(exc)[:500]}))
        raise SystemExit(1)
