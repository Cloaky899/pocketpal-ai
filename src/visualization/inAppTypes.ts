export const IN_APP_VISUALIZATION_SCHEMA_VERSION = 1 as const;
export const IN_APP_ENGINE = 'manim-web' as const;

export type InAppVector = readonly [number, number];
export type InAppColor = string;
export type InAppEasing = 'linear' | 'smooth' | 'there-and-back' | 'rush-from';

export type InAppPrimitive =
  | {
      kind: 'text';
      id: string;
      text: string;
      position?: InAppVector;
      fontSize?: number;
      color?: InAppColor;
    }
  | {
      kind: 'math';
      id: string;
      latex: string;
      position?: InAppVector;
      fontSize?: number;
      color?: InAppColor;
    }
  | {
      kind: 'circle';
      id: string;
      radius?: number;
      position?: InAppVector;
      color?: InAppColor;
      fillColor?: InAppColor;
      fillOpacity?: number;
    }
  | {
      kind: 'square';
      id: string;
      sideLength?: number;
      position?: InAppVector;
      color?: InAppColor;
      fillColor?: InAppColor;
      fillOpacity?: number;
    }
  | {
      kind: 'rectangle';
      id: string;
      width?: number;
      height?: number;
      position?: InAppVector;
      color?: InAppColor;
      fillColor?: InAppColor;
      fillOpacity?: number;
    }
  | {
      kind: 'line' | 'arrow';
      id: string;
      start: InAppVector;
      end: InAppVector;
      color?: InAppColor;
      strokeWidth?: number;
    }
  | {
      kind: 'dot';
      id: string;
      position?: InAppVector;
      radius?: number;
      color?: InAppColor;
    }
  | {
      kind: 'axes';
      id: string;
      xRange?: readonly [number, number, number];
      yRange?: readonly [number, number, number];
      xLength?: number;
      yLength?: number;
      color?: InAppColor;
    }
  | {
      kind: 'graph';
      id: string;
      expression: 'sin' | 'cos' | 'tan' | 'quadratic' | 'linear' | 'sqrt';
      xRange?: readonly [number, number];
      color?: InAppColor;
      strokeWidth?: number;
    };

export type InAppAnimation =
  | {
      kind: 'create' | 'write' | 'fade-in' | 'fade-out';
      targetId: string;
      durationSeconds?: number;
      easing?: InAppEasing;
    }
  | {
      kind: 'transform';
      targetId: string;
      replacementId: string;
      durationSeconds?: number;
      easing?: InAppEasing;
    }
  | {
      kind: 'move-to' | 'shift';
      targetId: string;
      position: InAppVector;
      durationSeconds?: number;
      easing?: InAppEasing;
    }
  | {
      kind: 'rotate';
      targetId: string;
      angleRadians: number;
      durationSeconds?: number;
      easing?: InAppEasing;
    }
  | {
      kind: 'scale';
      targetId: string;
      factor: number;
      durationSeconds?: number;
      easing?: InAppEasing;
    }
  | {
      kind: 'wait';
      durationSeconds: number;
    };

export type InAppScene = {
  sceneId: string;
  title: string;
  durationSeconds: number;
  primitives: InAppPrimitive[];
  animations: InAppAnimation[];
};

export type VisualizationProgram = {
  schemaVersion: typeof IN_APP_VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  engine: typeof IN_APP_ENGINE;
  aspectRatio: '16:9' | '9:16' | '1:1';
  backgroundColor: InAppColor;
  scenes: InAppScene[];
};

export type CompiledPrimitive = InAppPrimitive & {
  position: InAppVector;
};

export type CompiledAnimation = InAppAnimation & {
  durationSeconds: number;
  easing: InAppEasing;
  startSeconds: number;
};

export type CompiledScene = {
  sceneId: string;
  title: string;
  durationSeconds: number;
  primitives: CompiledPrimitive[];
  animations: CompiledAnimation[];
};

export type CompiledSceneBundle = {
  schemaVersion: typeof IN_APP_VISUALIZATION_SCHEMA_VERSION;
  requestId: string;
  engine: typeof IN_APP_ENGINE;
  aspectRatio: VisualizationProgram['aspectRatio'];
  backgroundColor: InAppColor;
  scenes: CompiledScene[];
  totalDurationSeconds: number;
  contentHash: string;
};

export type InAppRenderMetrics = {
  compileMs: number;
  firstFrameMs: number;
  frameCount: number;
  droppedFrameCount: number;
  runtimeErrorCount: number;
};

export type InAppRendererStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'compiling'
  | 'rendering'
  | 'paused'
  | 'failed'
  | 'disposed';

export type InAppReviewReport = {
  technicalChecks: Array<{name: string; passed: boolean; message: string}>;
  visualChecks: Array<{name: string; passed: boolean; message: string}>;
  proposedRepairs: string[];
  needsRevision: boolean;
};

export type InAppVisualizationPhase =
  | 'idle'
  | 'planning'
  | 'generating'
  | 'validating'
  | 'compiling'
  | 'rendering'
  | 'reviewing'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type InAppVisualizationState = {
  requestId: string;
  phase: InAppVisualizationPhase;
  repairAttempt: number;
  maxRepairAttempts: number;
  scenePlan?: unknown;
  program?: VisualizationProgram;
  bundle?: CompiledSceneBundle;
  review?: InAppReviewReport;
  frameDataUrls: string[];
  metrics?: InAppRenderMetrics;
  error?: string;
};
