export const VISUALIZATION_SCHEMA_VERSION = 1 as const;
export const MANIM_FRAMEWORK = 'manim-ce' as const;
export const MAX_REPAIR_ATTEMPTS = 3 as const;

export type VisualizationAudience = 'beginner' | 'intermediate' | 'advanced';
export type VisualizationAspectRatio = '16:9' | '9:16' | '1:1';
export type VisualizationQuality = 'preview' | 'high';
export type VisualizationPrivacyMode = 'local-first' | 'remote-renderer';
export type VisualizationNarration =
  | 'none'
  | 'subtitles'
  | 'voice-and-subtitles';

export type VisualizationRequest = {
  schemaVersion: typeof VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  prompt: string;
  audience: VisualizationAudience;
  aspectRatio: VisualizationAspectRatio;
  durationSeconds: number;
  quality: VisualizationQuality;
  narration: VisualizationNarration;
  privacyMode: VisualizationPrivacyMode;
  model?: string;
  systemPrompt?: string;
};

export type SceneTechnicalNotes = {
  framework: typeof MANIM_FRAMEWORK;
  requiredImports: string[];
  plugin?: string;
  notes?: string;
};

export type SceneSpec = {
  sceneId: string;
  title: string;
  learningObjective: string;
  visualElements: string[];
  animationBeats: string[];
  durationSeconds: number;
  technicalNotes: SceneTechnicalNotes;
};

export type ScenePlan = {
  schemaVersion: typeof VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  title: string;
  summary: string;
  scenes: SceneSpec[];
  totalDurationSeconds: number;
};

export type ManimProgram = {
  schemaVersion: typeof VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  framework: typeof MANIM_FRAMEWORK;
  entrypoint: string;
  sceneNames: string[];
  code: string;
  imports: string[];
};

export type RenderQuality = 'low' | 'high';
export type RenderJobStatus =
  | 'queued'
  | 'planning'
  | 'generating'
  | 'validating'
  | 'rendering-preview'
  | 'reviewing'
  | 'repairing'
  | 'rendering-final'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RenderFailureCategory =
  | 'schema'
  | 'policy'
  | 'dependency'
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'resource'
  | 'artifact'
  | 'network'
  | 'cancelled'
  | 'unknown';

export type RenderOptions = {
  quality: RenderQuality;
  timeoutSeconds: number;
  aspectRatio: VisualizationAspectRatio;
  includeSubtitles: boolean;
};

export type RenderJob = {
  schemaVersion: typeof VISUALIZATION_SCHEMA_VERSION;
  jobId: string;
  requestId: string;
  status: RenderJobStatus;
  progress: number;
  attempt: number;
  maxAttempts: typeof MAX_REPAIR_ATTEMPTS;
  options: RenderOptions;
  failureCategory?: RenderFailureCategory;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type RenderArtifact = {
  kind:
    | 'preview-video'
    | 'final-video'
    | 'source-code'
    | 'scene-plan'
    | 'frame'
    | 'subtitles'
    | 'logs';
  uri: string;
  mimeType: string;
  sizeBytes?: number;
  sceneId?: string;
};

export type VisualizationArtifacts = {
  schemaVersion: typeof VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  jobId: string;
  artifacts: RenderArtifact[];
};

export type VisualizationHistoryEntry = {
  requestId: string;
  title: string;
  prompt: string;
  phase: Extract<AgentPhase, 'completed' | 'failed' | 'cancelled'>;
  createdAt: string;
  updatedAt: string;
  jobId?: string;
  artifacts: RenderArtifact[];
  renderMode?: 'local-first' | 'remote-renderer';
  programHash?: string;
  reviewPassed?: boolean;
  repairAttempt?: number;
  error?: string;
};

export type ReviewCheck = {
  name: string;
  passed: boolean;
  message: string;
};

export type ReviewReport = {
  schemaVersion: typeof VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  jobId: string;
  technicalChecks: ReviewCheck[];
  visualChecks: ReviewCheck[];
  proposedRepairs: string[];
  needsRevision: boolean;
};

export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'generating'
  | 'validating'
  | 'rendering-preview'
  | 'reviewing'
  | 'repairing'
  | 'rendering-final'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentState = {
  request: VisualizationRequest;
  phase: AgentPhase;
  repairAttempt: number;
  maxRepairAttempts: typeof MAX_REPAIR_ATTEMPTS;
  scenePlan?: ScenePlan;
  program?: ManimProgram;
  renderJob?: RenderJob;
  review?: ReviewReport;
  artifacts?: VisualizationArtifacts;
  error?: string;
};

export type AgentEvent =
  | {type: 'start'}
  | {type: 'scene-plan-ready'; scenePlan: ScenePlan}
  | {type: 'program-ready'; program: ManimProgram}
  | {type: 'validation-failed'; message: string}
  | {type: 'preview-submitted'; renderJob: RenderJob}
  | {type: 'preview-succeeded'; renderJob: RenderJob}
  | {type: 'preview-failed'; message: string}
  | {type: 'review-ready'; review: ReviewReport}
  | {type: 'repair-failed'; message: string}
  | {type: 'final-submitted'; renderJob: RenderJob}
  | {type: 'final-failed'; message: string}
  | {
      type: 'final-succeeded';
      renderJob: RenderJob;
      artifacts: VisualizationArtifacts;
    }
  | {type: 'failed'; message: string}
  | {type: 'cancel'};

export type ModelMessageRole = 'system' | 'user' | 'assistant';

export type ModelMessage = {
  role: ModelMessageRole;
  content: string;
};

export type StructuredModelContent =
  | string
  | Array<
      | {type: 'text'; text: string}
      | {type: 'image_url'; image_url: {url: string}}
    >;

export type StructuredModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: StructuredModelContent;
};

export type StructuredModelResponse = {
  content: string;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export type VisualizationModel = {
  complete(messages: ModelMessage[]): Promise<StructuredModelResponse>;
};
