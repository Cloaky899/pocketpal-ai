import {
  createAgentState,
  InvalidAgentTransitionError,
  transitionAgentState,
} from '../src/visualization/agentState';
import {
  validateManimProgram,
  validateRenderOptions,
  validateScenePlan,
  validateVisualizationRequest,
  VisualizationValidationError,
} from '../src/visualization/validation';
import {
  MAX_REPAIR_ATTEMPTS,
  VISUALIZATION_SCHEMA_VERSION,
} from '../src/visualization/types';

const request = {
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  requestId: 'request-1',
  prompt: 'Explain a rotating vector.',
  audience: 'beginner' as const,
  aspectRatio: '16:9' as const,
  durationSeconds: 30,
  quality: 'preview' as const,
  narration: 'none' as const,
  privacyMode: 'remote-renderer' as const,
};

const scenePlan = {
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  requestId: 'request-1',
  title: 'Rotating vector',
  summary: 'Show a vector rotating around the origin.',
  scenes: [
    {
      sceneId: 'scene-1',
      title: 'Rotation',
      learningObjective: 'Connect angle and direction.',
      visualElements: ['axes', 'vector'],
      animationBeats: ['draw axes', 'rotate vector'],
      durationSeconds: 10,
      technicalNotes: {
        framework: 'manim-ce' as const,
        requiredImports: ['manim'],
      },
    },
  ],
  totalDurationSeconds: 10,
};

const program = {
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  requestId: 'request-1',
  framework: 'manim-ce' as const,
  entrypoint: 'video.py',
  sceneNames: ['RotationScene'],
  code: 'from manim import *\n\nclass RotationScene(Scene):\n    pass\n',
  imports: ['manim'],
};

const renderJob = {
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  jobId: 'job-1',
  requestId: 'request-1',
  status: 'queued' as const,
  progress: 0,
  attempt: 0,
  maxAttempts: MAX_REPAIR_ATTEMPTS,
  options: {
    quality: 'low' as const,
    timeoutSeconds: 120,
    aspectRatio: '16:9' as const,
    includeSubtitles: false,
  },
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const review = {
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  requestId: 'request-1',
  jobId: 'job-1',
  technicalChecks: [{name: 'syntax', passed: true, message: 'ok'}],
  visualChecks: [{name: 'legibility', passed: true, message: 'ok'}],
  proposedRepairs: [],
  needsRevision: false,
};

const artifacts = {
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  requestId: 'request-1',
  jobId: 'job-1',
  artifacts: [
    {
      kind: 'final-video' as const,
      uri: 'https://example.invalid/video.mp4',
      mimeType: 'video/mp4',
    },
  ],
};

describe('visualization validation', () => {
  it('accepts the versioned request, scene plan, program, and render options', () => {
    expect(validateVisualizationRequest(request)).toEqual(request);
    expect(validateScenePlan(scenePlan)).toEqual(scenePlan);
    expect(validateManimProgram(program)).toEqual(program);
    expect(validateRenderOptions(renderJob.options)).toEqual(renderJob.options);
  });

  it('rejects unsupported or unsafe program content', () => {
    expect(() =>
      validateVisualizationRequest({...request, durationSeconds: 0}),
    ).toThrow(VisualizationValidationError);
    expect(() =>
      validateManimProgram({
        ...program,
        imports: ['os'],
        code: 'import os\n\nclass UnsafeScene(Scene):\n    pass\n',
      }),
    ).toThrow('Disallowed import: os');
    expect(() =>
      validateManimProgram({
        ...program,
        code: 'eval("unsafe")\n\nclass UnsafeScene(Scene):\n    pass\n',
      }),
    ).toThrow('disallowed execution primitive');
  });
});

describe('bounded visualization agent state machine', () => {
  it('transitions through preview, review, final render, and completion', () => {
    let state = createAgentState(request);
    state = transitionAgentState(state, {type: 'start'});
    state = transitionAgentState(state, {type: 'scene-plan-ready', scenePlan});
    state = transitionAgentState(state, {type: 'program-ready', program});
    state = transitionAgentState(state, {type: 'preview-submitted', renderJob});
    state = transitionAgentState(state, {type: 'preview-succeeded', renderJob});
    state = transitionAgentState(state, {type: 'review-ready', review});
    state = transitionAgentState(state, {type: 'final-submitted', renderJob});
    state = transitionAgentState(state, {
      type: 'final-succeeded',
      renderJob,
      artifacts,
    });
    expect(state.phase).toBe('completed');
    expect(state.artifacts).toEqual(artifacts);
  });

  it('caps repair attempts and fails after the cap', () => {
    let state = createAgentState(request);
    state = transitionAgentState(state, {type: 'start'});
    state = transitionAgentState(state, {type: 'scene-plan-ready', scenePlan});
    state = transitionAgentState(state, {type: 'program-ready', program});
    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
      state = transitionAgentState(state, {
        type: 'validation-failed',
        message: `failure-${attempt}`,
      });
      expect(state.phase).toBe('repairing');
      state = transitionAgentState(state, {type: 'program-ready', program});
    }
    state = transitionAgentState(state, {
      type: 'validation-failed',
      message: 'final failure',
    });
    expect(state.phase).toBe('failed');
    expect(state.repairAttempt).toBe(MAX_REPAIR_ATTEMPTS);
  });

  it('rejects impossible transitions', () => {
    const state = createAgentState(request);
    expect(() =>
      transitionAgentState(state, {
        type: 'final-succeeded',
        renderJob,
        artifacts,
      }),
    ).toThrow(InvalidAgentTransitionError);
  });
});
