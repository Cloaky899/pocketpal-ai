import {compileVisualizationProgram} from './dslCompiler';
import {
  buildInAppPlannerMessages,
  buildInAppProgramMessages,
  buildInAppRepairMessages,
  buildInAppTechnicalReviewMessages,
  buildInAppVisualReviewMessages,
} from './inAppPrompts';
import {
  type InAppReviewReport,
  type InAppVisualizationState,
  type VisualizationProgram,
} from './inAppTypes';
import {InAppRendererController} from './inAppRenderer';
import type {VisualizationModelAdapter} from './rendererClient';
import {
  validateScenePlan,
  validateVisualizationRequest,
  VisualizationValidationError,
} from './validation';
import {validateVisualizationProgram} from './inAppValidation';
import type {VisualizationRequest, ScenePlan} from './types';

export type InAppVisualizationPipelineOptions = {
  request: VisualizationRequest;
  model: VisualizationModelAdapter;
  renderer: InAppRendererController;
  requestContext?: string;
  onState?: (state: InAppVisualizationState) => void;
  maxRepairAttempts?: number;
};

function initialState(requestId: string): InAppVisualizationState {
  return {
    requestId,
    phase: 'idle',
    repairAttempt: 0,
    maxRepairAttempts: 3,
    frameDataUrls: [],
  };
}

function reviewReport(value: unknown): InAppReviewReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VisualizationValidationError('In-app review must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const checks = (key: 'technicalChecks' | 'visualChecks') => {
    const rawChecks = raw[key];
    if (!Array.isArray(rawChecks)) {
      throw new VisualizationValidationError(`Review ${key} must be an array.`);
    }
    return rawChecks.map((check, index) => {
      if (!check || typeof check !== 'object' || Array.isArray(check)) {
        throw new VisualizationValidationError(
          `Review check ${key}[${index}] is invalid.`,
        );
      }
      const item = check as Record<string, unknown>;
      if (
        typeof item.name !== 'string' ||
        typeof item.message !== 'string' ||
        typeof item.passed !== 'boolean'
      ) {
        throw new VisualizationValidationError(
          `Review check ${key}[${index}] is incomplete.`,
        );
      }
      return {name: item.name, passed: item.passed, message: item.message};
    });
  };
  const proposedRepairs = Array.isArray(raw.proposedRepairs)
    ? raw.proposedRepairs
        .filter((repair): repair is string => typeof repair === 'string')
        .slice(0, 8)
    : [];
  if (typeof raw.needsRevision !== 'boolean') {
    throw new VisualizationValidationError(
      'Review needsRevision must be boolean.',
    );
  }
  return {
    technicalChecks: checks('technicalChecks'),
    visualChecks: checks('visualChecks'),
    proposedRepairs,
    needsRevision: raw.needsRevision,
  };
}

function deterministicTechnicalReview(
  frameDataUrls: string[],
  metrics: InAppVisualizationState['metrics'],
): InAppReviewReport {
  const checks = [
    {
      name: 'representative-frame',
      passed:
        frameDataUrls.length > 0 &&
        frameDataUrls.every(frame => frame.startsWith('data:image/')),
      message:
        frameDataUrls.length > 0
          ? 'Representative frames were captured.'
          : 'No representative frame was captured.',
    },
    {
      name: 'runtime-errors',
      passed: (metrics?.runtimeErrorCount ?? 1) === 0,
      message:
        (metrics?.runtimeErrorCount ?? 1) === 0
          ? 'The local runtime reported no errors.'
          : 'The local runtime reported an error.',
    },
    {
      name: 'frame-budget',
      passed: (metrics?.frameCount ?? 0) > 0,
      message:
        (metrics?.frameCount ?? 0) > 0
          ? 'The local renderer produced frames.'
          : 'The local renderer produced no frames.',
    },
  ];
  const passed = checks.every(check => check.passed);
  return {
    technicalChecks: checks,
    visualChecks: [],
    proposedRepairs: passed
      ? []
      : checks.filter(check => !check.passed).map(check => check.message),
    needsRevision: !passed,
  };
}

function emit(
  options: InAppVisualizationPipelineOptions,
  state: InAppVisualizationState,
): InAppVisualizationState {
  options.onState?.(state);
  return state;
}

function contextFor(options: InAppVisualizationPipelineOptions): string {
  return (
    options.requestContext ??
    `Audience: ${options.request.audience}; aspect ratio: ${options.request.aspectRatio}; duration: ${options.request.durationSeconds}s; local engine: manim-web.`
  );
}

async function captureRepresentativeFrames(
  renderer: InAppRendererController,
  durationSeconds: number,
): Promise<string[]> {
  const times = [
    0,
    Math.max(0, durationSeconds / 2),
    Math.max(0, durationSeconds - 0.05),
  ];
  const frames: string[] = [];
  for (const time of times) {
    await renderer.seek(time);
    const frame = await renderer.captureFrame();
    if (frame.length <= 5_000_000) frames.push(frame);
  }
  return frames;
}

export async function runInAppVisualization(
  options: InAppVisualizationPipelineOptions,
): Promise<InAppVisualizationState> {
  validateVisualizationRequest(options.request);
  const maxRepairAttempts = Math.max(
    0,
    Math.min(3, options.maxRepairAttempts ?? 3),
  );
  let state = emit(options, {
    ...initialState(options.request.requestId),
    maxRepairAttempts,
  });
  let program: VisualizationProgram | undefined;

  try {
    state = emit(options, {...state, phase: 'planning'});
    const scenePlan = validateScenePlan(
      await options.model.completeJson<ScenePlan>(
        buildInAppPlannerMessages(options.request.prompt, contextFor(options)),
      ),
    );
    state = emit(options, {...state, scenePlan, phase: 'generating'});

    program = validateVisualizationProgram(
      await options.model.completeJson<VisualizationProgram>(
        buildInAppProgramMessages(
          JSON.stringify(scenePlan),
          contextFor(options),
        ),
      ),
    );

    while (state.repairAttempt <= state.maxRepairAttempts) {
      state = emit(options, {...state, phase: 'validating', program});
      const bundle = compileVisualizationProgram(program);
      state = emit(options, {...state, bundle, phase: 'compiling'});
      await options.renderer.loadProgram(bundle, options.request.requestId);
      state = emit(options, {...state, phase: 'rendering'});
      const renderEvent = await options.renderer.play();
      const metrics =
        renderEvent.type === 'renderResult' ? renderEvent.metrics : undefined;
      const frameDataUrls = await captureRepresentativeFrames(
        options.renderer,
        bundle.totalDurationSeconds,
      );
      const technical = deterministicTechnicalReview(frameDataUrls, metrics);
      if (technical.needsRevision) {
        state = emit(options, {
          ...state,
          review: technical,
          frameDataUrls,
          metrics,
          phase: 'repairing',
        });
      } else {
        state = emit(options, {
          ...state,
          frameDataUrls,
          metrics,
          phase: 'reviewing',
        });
        const modelTechnical = reviewReport(
          await options.model.completeJson<InAppReviewReport>(
            buildInAppTechnicalReviewMessages(
              bundle,
              JSON.stringify({metrics}),
            ),
          ),
        );
        const visual = reviewReport(
          await options.model.completeJson<InAppReviewReport>(
            buildInAppVisualReviewMessages(program, frameDataUrls),
          ),
        );
        const combined: InAppReviewReport = {
          technicalChecks: [
            ...technical.technicalChecks,
            ...modelTechnical.technicalChecks,
          ],
          visualChecks: visual.visualChecks,
          proposedRepairs: [
            ...modelTechnical.proposedRepairs,
            ...visual.proposedRepairs,
          ].slice(0, 8),
          needsRevision:
            modelTechnical.needsRevision ||
            visual.needsRevision ||
            modelTechnical.technicalChecks.some(check => !check.passed) ||
            visual.visualChecks.some(check => !check.passed),
        };
        state = emit(options, {...state, review: combined});
        if (!combined.needsRevision) {
          return emit(options, {...state, phase: 'completed'});
        }
      }

      if (state.repairAttempt >= state.maxRepairAttempts) {
        return emit(options, {
          ...state,
          phase: 'failed',
          error:
            'The in-app visualization did not pass review within the repair budget.',
        });
      }
      const review = state.review;
      const repaired = validateVisualizationProgram(
        await options.model.completeJson<VisualizationProgram>(
          buildInAppRepairMessages(program, JSON.stringify(review)),
        ),
      );
      program = repaired;
      state = emit(options, {
        ...state,
        program,
        repairAttempt: state.repairAttempt + 1,
        phase: 'repairing',
      });
    }
    return emit(options, {
      ...state,
      phase: 'failed',
      error: 'In-app repair loop exhausted.',
    });
  } catch (error) {
    return emit(options, {
      ...state,
      phase: 'failed',
      error:
        error instanceof Error ? error.message : 'In-app visualization failed.',
    });
  }
}
