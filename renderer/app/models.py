from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = 1
MAX_CODE_BYTES = 250_000
MAX_PROMPT_BYTES = 20_000
MAX_TIMEOUT_SECONDS = 900


class RenderQuality(str, Enum):
    low = "low"
    high = "high"


class RenderStatus(str, Enum):
    queued = "queued"
    rendering = "rendering"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class FailureCategory(str, Enum):
    schema = "schema"
    policy = "policy"
    syntax = "syntax"
    dependency = "dependency"
    runtime = "runtime"
    timeout = "timeout"
    resource = "resource"
    artifact = "artifact"
    cancelled = "cancelled"
    unknown = "unknown"


class RenderOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quality: RenderQuality = RenderQuality.low
    timeout_seconds: int = Field(default=120, ge=1, le=MAX_TIMEOUT_SECONDS)
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    include_subtitles: bool = False


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[SCHEMA_VERSION] = SCHEMA_VERSION
    request_id: str = Field(min_length=1, max_length=128)
    program: dict
    options: RenderOptions = Field(default_factory=RenderOptions)

    @field_validator("program")
    @classmethod
    def validate_program_size(cls, value: dict) -> dict:
        code = value.get("code")
        if not isinstance(code, str) or not code.strip():
            raise ValueError("program.code must be a non-empty string")
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            raise ValueError("program.code exceeds the maximum allowed size")
        return value


class Artifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["preview-video", "final-video", "frame", "logs"]
    name: str
    path: str
    mime_type: str
    size_bytes: int = Field(ge=0)


class RenderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[SCHEMA_VERSION] = SCHEMA_VERSION
    job_id: str
    request_id: str
    status: RenderStatus
    progress: int = Field(ge=0, le=100)
    failure_category: FailureCategory | None = None
    error_message: str | None = None
    artifacts: list[Artifact] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    healthy: bool
    renderer: str
    manim_version: str | None = None
    python_version: str
    ffmpeg_version: str | None = None
    capabilities: list[str]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
