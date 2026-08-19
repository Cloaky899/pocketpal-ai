import type {
  ManimProgram,
  RenderJob,
  RenderOptions,
  ScenePlan,
  VisualizationArtifacts,
} from './types';

export type RenderJobSubmission = {
  requestId: string;
  scenePlan: ScenePlan;
  program: ManimProgram;
  options: RenderOptions;
};

export type RendererHealth = {
  healthy: boolean;
  renderer: string;
  manimVersion?: string;
  pythonVersion?: string;
  ffmpegVersion?: string;
  capabilities: string[];
};

export interface RendererPort {
  getHealth(): Promise<RendererHealth>;
  submitJob(input: RenderJobSubmission): Promise<RenderJob>;
  getJobStatus(jobId: string): Promise<RenderJob>;
  getArtifacts(jobId: string): Promise<VisualizationArtifacts>;
  cancelJob(jobId: string): Promise<void>;
}

export class RendererRequestError extends Error {
  readonly status?: number;
  readonly jobId?: string;

  constructor(
    message: string,
    options: {status?: number; jobId?: string} = {},
  ) {
    super(message);
    this.name = 'RendererRequestError';
    this.status = options.status;
    this.jobId = options.jobId;
  }
}
