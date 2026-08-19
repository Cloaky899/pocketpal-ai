import {createAgentState, transitionAgentState} from './agentState';
import {
  buildProgramWriterMessages,
  buildRepairMessages,
  buildScenePlannerMessages,
} from './prompts';
import {
  scenePlanToSubmission,
  type VisualizationModelAdapter,
} from './rendererClient';
import type {RendererPort} from './renderer';
import {
  type AgentState,
  type ManimProgram,
  type RenderJob,
  type RenderOptions,
  type ReviewReport,
  type ScenePlan,
  type VisualizationRequest,
} from './types';
import {
  validateManimProgram,
  validateScenePlan,
  validateVisualizationRequest,
  VisualizationValidationError,
} from './validation';

export type VisualizationPipelineOptions = {
  request: VisualizationRequest;
  model: VisualizationModelAdapter;
  renderer: RendererPort;
  requestContext?: string;
  onState?: (state: AgentState) => void;
  pollIntervalMs?: number;
};

function emit(
  options: VisualizationPipelineOptions,
  state: AgentState,
): AgentState {
  options.onState?.(state);
  return state;
}

function reviewForRender(
  requestId: string,
  jobId: string,
  message: string,
  passed: boolean,
): ReviewReport {
  return {
    schemaVersion: 1,
    requestId,
    jobId,
    technicalChecks: [{name: 'renderer', passed, message}],
    visualChecks: [{name: 'representative-frame', passed, message}],
    proposedRepairs: passed ? [] : [message],
    needsRevision: !passed,
  };
}

function renderOptions(
  request: VisualizationRequest,
  quality: RenderOptions['quality'],
): RenderOptions {
  return {
    quality,
    timeoutSeconds: Math.max(30, Math.ceil(request.durationSeconds * 8)),
    aspectRatio: request.aspectRatio,
    includeSubtitles: request.narration !== 'none',
  };
}

async function waitForJob(
  renderer: RendererPort,
  initial: RenderJob,
  pollIntervalMs: number,
): Promise<RenderJob> {
  let current = initial;
  const deadline = Date.now() + initial.options.timeoutSeconds * 1000 + 30_000;
  while (
    current.status !== 'completed' &&
    current.status !== 'failed' &&
    current.status !== 'cancelled'
  ) {
    if (Date.now() > deadline) {
      throw new Error('Renderer job polling timed out.');
    }
    await new Promise<void>(resolve => {
      setTimeout(resolve, pollIntervalMs);
    });
    current = await renderer.getJobStatus(current.jobId);
  }
  return current;
}

export async function runVisualization(
  options: VisualizationPipelineOptions,
): Promise<AgentState> {
  validateVisualizationRequest(options.request);
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  let state = emit(options, createAgentState(options.request));
  state = emit(options, transitionAgentState(state, {type: 'start'}));

  try {
    const requestContext =
      options.requestContext ??
      `Audience: ${options.request.audience}; aspect ratio: ${options.request.aspectRatio}; duration: ${options.request.durationSeconds}s.`;
    const scenePlan = validateScenePlan(
      await options.model.completeJson<ScenePlan>(
        buildScenePlannerMessages(options.request.prompt, requestContext),
      ),
    );
    state = emit(
      options,
      transitionAgentState(state, {type: 'scene-plan-ready', scenePlan}),
    );

    let program = validateManimProgram(
      await options.model.completeJson<ManimProgram>(
        buildProgramWriterMessages(JSON.stringify(scenePlan), requestContext),
      ),
    );
    state = emit(
      options,
      transitionAgentState(state, {type: 'program-ready', program}),
    );

    while (
      state.phase !== 'completed' &&
      state.phase !== 'failed' &&
      state.phase !== 'cancelled'
    ) {
      try {
        program = validateManimProgram(program);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Generated program failed validation.';
        state = emit(
          options,
          transitionAgentState(state, {type: 'validation-failed', message}),
        );
        if (state.phase === 'failed') return state;
        program = await repairProgram(options, state, program, message);
        state = emit(
          options,
          transitionAgentState(state, {type: 'program-ready', program}),
        );
        continue;
      }

      const preview = await options.renderer.submitJob(
        scenePlanToSubmission(
          options.request.requestId,
          scenePlan,
          program,
          renderOptions(options.request, 'low'),
        ),
      );
      state = emit(
        options,
        transitionAgentState(state, {
          type: 'preview-submitted',
          renderJob: preview,
        }),
      );
      const previewResult = await waitForJob(
        options.renderer,
        preview,
        pollIntervalMs,
      );
      if (previewResult.status !== 'completed') {
        const message = previewResult.errorMessage ?? 'Preview render failed.';
        state = emit(
          options,
          transitionAgentState(state, {type: 'preview-failed', message}),
        );
        if (state.phase === 'failed') return state;
        program = await repairProgram(options, state, program, message);
        state = emit(
          options,
          transitionAgentState(state, {type: 'program-ready', program}),
        );
        continue;
      }

      state = emit(
        options,
        transitionAgentState(state, {
          type: 'preview-succeeded',
          renderJob: previewResult,
        }),
      );
      const previewArtifacts = await options.renderer.getArtifacts(
        previewResult.jobId,
      );
      const review = reviewForRender(
        options.request.requestId,
        previewResult.jobId,
        'Preview rendered and representative frames were produced.',
        true,
      );
      state = emit(
        options,
        transitionAgentState(state, {type: 'review-ready', review}),
      );

      if (options.request.quality === 'preview') {
        state = emit(
          options,
          transitionAgentState(state, {
            type: 'final-succeeded',
            renderJob: previewResult,
            artifacts: previewArtifacts,
          }),
        );
        return state;
      }

      const finalJob = await options.renderer.submitJob(
        scenePlanToSubmission(
          options.request.requestId,
          scenePlan,
          program,
          renderOptions(options.request, 'high'),
        ),
      );
      state = emit(
        options,
        transitionAgentState(state, {
          type: 'final-submitted',
          renderJob: finalJob,
        }),
      );
      const finalResult = await waitForJob(
        options.renderer,
        finalJob,
        pollIntervalMs,
      );
      if (finalResult.status !== 'completed') {
        const message = finalResult.errorMessage ?? 'Final render failed.';
        state = emit(
          options,
          transitionAgentState(state, {type: 'final-failed', message}),
        );
        if (state.phase === 'failed') return state;
        program = await repairProgram(options, state, program, message);
        state = emit(
          options,
          transitionAgentState(state, {type: 'program-ready', program}),
        );
        continue;
      }
      const artifacts = await options.renderer.getArtifacts(finalResult.jobId);
      state = emit(
        options,
        transitionAgentState(state, {
          type: 'final-succeeded',
          renderJob: finalResult,
          artifacts,
        }),
      );
      return state;
    }
    return state;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Visualization generation failed.';
    if (
      state.phase !== 'failed' &&
      state.phase !== 'cancelled' &&
      state.phase !== 'completed'
    ) {
      state = emit(
        options,
        transitionAgentState(state, {type: 'failed', message}),
      );
    }
    return state;
  }
}

async function repairProgram(
  options: VisualizationPipelineOptions,
  state: AgentState,
  program: ManimProgram,
  message: string,
): Promise<ManimProgram> {
  try {
    const review = reviewForRender(
      options.request.requestId,
      state.renderJob?.jobId ?? 'local-validation',
      message,
      false,
    );
    return validateManimProgram(
      await options.model.completeJson<ManimProgram>(
        buildRepairMessages(JSON.stringify(program), JSON.stringify(review)),
      ),
    );
  } catch (error) {
    const detail =
      error instanceof VisualizationValidationError || error instanceof Error
        ? error.message
        : 'Repair generation failed.';
    throw new Error(`Repair generation failed: ${detail}`);
  }
}
