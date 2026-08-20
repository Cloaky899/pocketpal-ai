import {
  MANIM_FRAMEWORK,
  type ManimProgram,
  type RenderJob,
  type RenderOptions,
  type ScenePlan,
  type VisualizationArtifacts,
  type StructuredModelMessage,
} from './types';
import {
  RendererRequestError,
  type RendererHealth,
  type RendererPort,
  type RenderJobSubmission,
} from './renderer';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function toRenderJob(payload: Record<string, unknown>): RenderJob {
  return {
    schemaVersion: Number(payload.schema_version ?? 1) as 1,
    jobId: String(payload.job_id),
    requestId: String(payload.request_id),
    status: String(payload.status) as RenderJob['status'],
    progress: Number(payload.progress ?? 0),
    attempt: 0,
    maxAttempts: 3,
    options: {
      quality: String(
        (payload.options as Record<string, unknown> | undefined)?.quality ??
          'low',
      ) as RenderOptions['quality'],
      timeoutSeconds: Number(
        (payload.options as Record<string, unknown> | undefined)
          ?.timeout_seconds ?? 120,
      ),
      aspectRatio: String(
        (payload.options as Record<string, unknown> | undefined)
          ?.aspect_ratio ?? '16:9',
      ) as RenderOptions['aspectRatio'],
      includeSubtitles: Boolean(
        (payload.options as Record<string, unknown> | undefined)
          ?.include_subtitles ?? false,
      ),
    },
    failureCategory: payload.failure_category as RenderJob['failureCategory'],
    errorMessage: payload.error_message
      ? String(payload.error_message)
      : undefined,
    createdAt: String(payload.created_at),
    updatedAt: String(payload.updated_at),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const detail =
      typeof payload.detail === 'string'
        ? payload.detail
        : `Renderer request failed (${response.status}).`;
    throw new RendererRequestError(detail, {status: response.status});
  }
  return payload;
}

export class RemoteRendererClient implements RendererPort {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    if (!baseUrl.trim()) {
      throw new RendererRequestError('A renderer URL is required.');
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async getHealth(): Promise<RendererHealth> {
    const response = await fetch(`${this.baseUrl}/health`);
    const payload = await readJson(response);
    return {
      healthy: Boolean(payload.healthy),
      renderer: String(payload.renderer ?? 'unknown'),
      manimVersion: payload.manim_version
        ? String(payload.manim_version)
        : undefined,
      pythonVersion: String(payload.python_version ?? 'unknown'),
      ffmpegVersion: payload.ffmpeg_version
        ? String(payload.ffmpeg_version)
        : undefined,
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.map(String)
        : [],
    };
  }

  async submitJob(input: RenderJobSubmission): Promise<RenderJob> {
    const response = await fetch(`${this.baseUrl}/render-jobs`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        schema_version: 1,
        request_id: input.requestId,
        program: {
          schema_version: 1,
          request_id: input.requestId,
          framework: MANIM_FRAMEWORK,
          entrypoint: input.program.entrypoint,
          scene_names: input.program.sceneNames,
          code: input.program.code,
          imports: input.program.imports,
        },
        options: {
          quality: input.options.quality === 'high' ? 'high' : 'low',
          timeout_seconds: input.options.timeoutSeconds,
          aspect_ratio: input.options.aspectRatio,
          include_subtitles: input.options.includeSubtitles,
        },
      }),
    });
    const payload = await readJson(response);
    return toRenderJob(payload);
  }

  async getJobStatus(jobId: string): Promise<RenderJob> {
    const response = await fetch(
      `${this.baseUrl}/render-jobs/${encodeURIComponent(jobId)}`,
    );
    const payload = await readJson(response);
    return toRenderJob(payload);
  }

  async getArtifacts(jobId: string): Promise<VisualizationArtifacts> {
    const response = await fetch(
      `${this.baseUrl}/render-jobs/${encodeURIComponent(jobId)}/artifacts`,
    );
    const payload = await readJson(response);
    const artifacts = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.artifacts)
        ? payload.artifacts
        : [];
    return {
      schemaVersion: 1,
      requestId: jobId,
      jobId,
      artifacts: artifacts.map(item => {
        const artifact = item as Record<string, unknown>;
        const kind = String(artifact.kind);
        return {
          kind:
            kind === 'final-video' ||
            kind === 'preview-video' ||
            kind === 'frame' ||
            kind === 'subtitles' ||
            kind === 'logs'
              ? (kind as VisualizationArtifacts['artifacts'][number]['kind'])
              : 'logs',
          uri: String(artifact.url ?? artifact.uri ?? ''),
          mimeType: kind.includes('video')
            ? 'video/mp4'
            : kind === 'frame'
              ? 'image/png'
              : 'text/plain',
          sizeBytes:
            typeof artifact.size_bytes === 'number'
              ? artifact.size_bytes
              : undefined,
        };
      }),
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/render-jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
      },
    );
    await readJson(response);
  }
}

export function createRemoteRendererClient(
  baseUrl: string,
): RemoteRendererClient {
  return new RemoteRendererClient(baseUrl);
}

export type VisualizationModelAdapter = {
  completeJson<T>(messages: StructuredModelMessage[]): Promise<T>;
};

export function scenePlanToSubmission(
  requestId: string,
  scenePlan: ScenePlan,
  program: ManimProgram,
  options: RenderOptions,
): RenderJobSubmission {
  return {requestId, scenePlan, program, options};
}
