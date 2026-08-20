import type {
  CompiledSceneBundle,
  InAppRenderMetrics,
  InAppRendererStatus,
} from './inAppTypes';

export const IN_APP_RENDERER_PROTOCOL_VERSION = 1 as const;

export type InAppCommand =
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'loadProgram';
      runId: string;
      bundle: CompiledSceneBundle;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'play' | 'pause' | 'captureFrame' | 'dispose';
      runId: string;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'seek';
      runId: string;
      time: number;
    };

export type InAppEvent =
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'ready';
      runId: string | null;
      sequence: number;
      engine: string;
      engineVersion: string;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'compileResult';
      runId: string | null;
      sequence: number;
      ok: boolean;
      compileMs?: number;
      durationSeconds?: number;
      objectCount?: number;
      message?: string;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'renderResult';
      runId: string | null;
      sequence: number;
      ok: boolean;
      currentTime?: number;
      metrics?: InAppRenderMetrics;
      message?: string;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'frameResult';
      runId: string | null;
      sequence: number;
      ok: boolean;
      currentTime?: number;
      dataUrl?: string;
      message?: string;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'status';
      runId: string | null;
      sequence: number;
      status: InAppRendererStatus;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'runtimeError';
      runId: string | null;
      sequence: number;
      stage: string;
      message: string;
    }
  | {
      protocolVersion: typeof IN_APP_RENDERER_PROTOCOL_VERSION;
      type: 'disposed';
      runId: string | null;
      sequence: number;
      ok: boolean;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseInAppEvent(value: unknown): InAppEvent {
  if (!isObject(value)) throw new Error('Renderer event must be an object.');
  if (value.protocolVersion !== IN_APP_RENDERER_PROTOCOL_VERSION) {
    throw new Error('Unsupported renderer protocol version.');
  }
  if (typeof value.type !== 'string' || typeof value.sequence !== 'number') {
    throw new Error('Renderer event is missing its type or sequence.');
  }
  const knownTypes = new Set([
    'ready',
    'compileResult',
    'renderResult',
    'frameResult',
    'status',
    'runtimeError',
    'disposed',
  ]);
  if (!knownTypes.has(value.type)) {
    throw new Error(`Unknown renderer event type: ${value.type}.`);
  }
  if (value.sequence < 1 || !Number.isInteger(value.sequence)) {
    throw new Error('Renderer event sequence is invalid.');
  }
  return value as InAppEvent;
}

export function serializeInAppCommand(command: InAppCommand): string {
  return JSON.stringify(command);
}
