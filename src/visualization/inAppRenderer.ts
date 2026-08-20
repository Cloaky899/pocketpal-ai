import type {CompiledSceneBundle, InAppRenderMetrics} from './inAppTypes';
import {
  IN_APP_RENDERER_PROTOCOL_VERSION,
  parseInAppEvent,
  serializeInAppCommand,
  type InAppCommand,
  type InAppEvent,
} from './inAppProtocol';

export type InAppRendererSnapshot = {
  status:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'compiling'
    | 'rendering'
    | 'paused'
    | 'failed'
    | 'disposed';
  runId: string | null;
  currentTime: number;
  metrics?: InAppRenderMetrics;
  lastError?: string;
};

type Pending = {
  types: Set<InAppEvent['type']>;
  resolve: (event: InAppEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class InAppRendererController {
  private webView: {postMessage: (message: string) => void} | null = null;
  private pending = new Set<Pending>();
  private lastSequence = 0;
  private snapshot: InAppRendererSnapshot = {
    status: 'idle',
    runId: null,
    currentTime: 0,
  };
  private onSnapshot?: (snapshot: InAppRendererSnapshot) => void;

  constructor(onSnapshot?: (snapshot: InAppRendererSnapshot) => void) {
    this.onSnapshot = onSnapshot;
  }

  attach(webView: {postMessage: (message: string) => void} | null): void {
    this.webView = webView;
  }

  detach(): void {
    this.webView = null;
    this.rejectAll(new Error('Renderer surface detached.'));
  }

  getSnapshot(): InAppRendererSnapshot {
    return this.snapshot;
  }

  setSnapshotListener(
    listener?: (snapshot: InAppRendererSnapshot) => void,
  ): void {
    this.onSnapshot = listener;
  }

  async loadProgram(
    bundle: CompiledSceneBundle,
    runId: string,
    timeoutMs = 15_000,
  ): Promise<InAppEvent> {
    this.update({
      status: 'compiling',
      runId,
      currentTime: 0,
      lastError: undefined,
    });
    const eventPromise = this.waitFor(
      new Set(['compileResult', 'runtimeError']),
      timeoutMs,
    );
    this.send({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'loadProgram',
      runId,
      bundle,
    });
    const event = await eventPromise;
    if (
      event.type === 'runtimeError' ||
      (event.type === 'compileResult' && !event.ok)
    ) {
      const message =
        event.type === 'runtimeError'
          ? event.message
          : (event.message ?? 'Compilation failed.');
      this.update({
        status: 'failed',
        runId,
        currentTime: 0,
        lastError: message,
      });
      throw new Error(message);
    }
    this.update({status: 'ready', runId, currentTime: 0});
    return event;
  }

  async play(timeoutMs = 120_000): Promise<InAppEvent> {
    this.requireWebView();
    const eventPromise = this.waitFor(
      new Set(['renderResult', 'runtimeError']),
      timeoutMs,
    );
    this.send({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'play',
      runId: this.requireRunId(),
    });
    const event = await eventPromise;
    if (
      event.type === 'runtimeError' ||
      (event.type === 'renderResult' && !event.ok)
    ) {
      const message =
        event.type === 'runtimeError'
          ? event.message
          : (event.message ?? 'Render failed.');
      this.update({
        status: 'failed',
        runId: this.requireRunId(),
        currentTime: 0,
        lastError: message,
      });
      throw new Error(message);
    }
    if (event.type === 'renderResult') {
      this.update({
        status: 'paused',
        runId: this.requireRunId(),
        currentTime: event.currentTime ?? 0,
        metrics: event.metrics,
      });
    }
    return event;
  }

  pause(): void {
    this.send({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'pause',
      runId: this.requireRunId(),
    });
    this.update({status: 'paused'});
  }

  async seek(time: number, timeoutMs = 5_000): Promise<InAppEvent> {
    if (!Number.isFinite(time) || time < 0)
      throw new Error('Seek time is invalid.');
    const eventPromise = this.waitFor(
      new Set(['frameResult', 'runtimeError']),
      timeoutMs,
    );
    this.send({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'seek',
      runId: this.requireRunId(),
      time,
    });
    const event = await eventPromise;
    if (
      event.type === 'runtimeError' ||
      (event.type === 'frameResult' && !event.ok)
    ) {
      throw new Error(
        event.type === 'runtimeError'
          ? event.message
          : (event.message ?? 'Seek failed.'),
      );
    }
    this.update({
      currentTime:
        event.type === 'frameResult' ? (event.currentTime ?? time) : time,
    });
    return event;
  }

  async captureFrame(timeoutMs = 10_000): Promise<string> {
    const eventPromise = this.waitFor(
      new Set(['frameResult', 'runtimeError']),
      timeoutMs,
    );
    this.send({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'captureFrame',
      runId: this.requireRunId(),
    });
    const event = await eventPromise;
    if (
      event.type === 'runtimeError' ||
      (event.type === 'frameResult' && !event.ok)
    ) {
      throw new Error(
        event.type === 'runtimeError'
          ? event.message
          : (event.message ?? 'Frame capture failed.'),
      );
    }
    if (event.type !== 'frameResult' || !event.dataUrl) {
      throw new Error('Renderer returned no frame data.');
    }
    return event.dataUrl;
  }

  async dispose(timeoutMs = 5_000): Promise<void> {
    if (!this.webView) return;
    const eventPromise = this.waitFor(
      new Set(['disposed', 'runtimeError']),
      timeoutMs,
    );
    this.send({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'dispose',
      runId: this.snapshot.runId ?? 'none',
    });
    await eventPromise.catch(() => undefined);
    this.rejectAll(new Error('Renderer disposed.'));
    this.update({status: 'disposed', runId: null, currentTime: 0});
  }

  handleMessage(data: string): void {
    let event: InAppEvent;
    try {
      event = parseInAppEvent(JSON.parse(data));
    } catch (error) {
      this.update({
        status: 'failed',
        lastError:
          error instanceof Error ? error.message : 'Invalid renderer event.',
      });
      return;
    }
    if (event.sequence <= this.lastSequence) return;
    this.lastSequence = event.sequence;
    if (event.type === 'ready') {
      this.update({status: 'ready'});
    }
    if (event.type === 'status') {
      this.update({status: event.status});
    }
    if (event.type === 'runtimeError') {
      this.update({status: 'failed', lastError: event.message});
    }
    for (const pending of [...this.pending]) {
      if (pending.types.has(event.type)) {
        clearTimeout(pending.timer);
        this.pending.delete(pending);
        pending.resolve(event);
      }
    }
  }

  private send(command: InAppCommand): void {
    this.requireWebView().postMessage(serializeInAppCommand(command));
  }

  private requireWebView(): {postMessage: (message: string) => void} {
    if (!this.webView) throw new Error('Renderer WebView is not attached.');
    return this.webView;
  }

  private requireRunId(): string {
    if (!this.snapshot.runId) throw new Error('No active renderer run.');
    return this.snapshot.runId;
  }

  private waitFor(
    types: Set<InAppEvent['type']>,
    timeoutMs: number,
  ): Promise<InAppEvent> {
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        types,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(pending);
          reject(
            new Error(
              `Renderer timed out waiting for ${[...types].join(' or ')}.`,
            ),
          );
        }, timeoutMs),
      };
      this.pending.add(pending);
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private update(patch: Partial<InAppRendererSnapshot>): void {
    this.snapshot = {...this.snapshot, ...patch};
    this.onSnapshot?.(this.snapshot);
  }
}
