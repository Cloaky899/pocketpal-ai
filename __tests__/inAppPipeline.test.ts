import {runInAppVisualization} from '../src/visualization/inAppPipeline';
import type {InAppRendererController} from '../src/visualization/inAppRenderer';
import type {VisualizationModelAdapter} from '../src/visualization/rendererClient';
import type {VisualizationRequest} from '../src/visualization/types';

const request: VisualizationRequest = {
  schemaVersion: 1,
  requestId: 'in-app-pipeline-test',
  prompt: 'Show a vector rotating around the origin.',
  audience: 'beginner',
  aspectRatio: '16:9',
  durationSeconds: 4,
  quality: 'preview',
  narration: 'none',
  privacyMode: 'local-first',
};

const plan = {
  schemaVersion: 1,
  requestId: request.requestId,
  title: 'Rotating vector',
  summary: 'A vector rotates around the origin.',
  scenes: [
    {
      sceneId: 'rotate',
      title: 'Rotation',
      learningObjective: 'Understand rotation around the origin.',
      visualElements: ['axes', 'vector'],
      animationBeats: ['draw axes', 'draw vector', 'rotate vector'],
      durationSeconds: 4,
      technicalNotes: {framework: 'manim-ce', requiredImports: []},
    },
  ],
  totalDurationSeconds: 4,
};

const program = {
  schemaVersion: 1,
  requestId: request.requestId,
  engine: 'manim-web',
  aspectRatio: '16:9',
  backgroundColor: '#1c1c1c',
  scenes: [
    {
      sceneId: 'rotate',
      title: 'Rotation',
      durationSeconds: 4,
      primitives: [
        {kind: 'axes', id: 'axes'},
        {kind: 'arrow', id: 'vector', start: [0, 0], end: [2, 1]},
      ],
      animations: [
        {kind: 'create', targetId: 'axes', durationSeconds: 0.5},
        {kind: 'create', targetId: 'vector', durationSeconds: 0.75},
        {
          kind: 'rotate',
          targetId: 'vector',
          angleRadians: 1,
          durationSeconds: 1,
        },
      ],
    },
  ],
};

const passedReview = {
  technicalChecks: [{name: 'runtime', passed: true, message: 'ok'}],
  visualChecks: [{name: 'legibility', passed: true, message: 'ok'}],
  proposedRepairs: [],
  needsRevision: false,
};

describe('in-app visualization pipeline', () => {
  it('requires local render and review before completion', async () => {
    const model = {
      completeJson: jest
        .fn()
        .mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(program)
        .mockResolvedValueOnce(passedReview)
        .mockResolvedValueOnce(passedReview),
    } as unknown as VisualizationModelAdapter;
    const renderer = {
      loadProgram: jest
        .fn()
        .mockResolvedValue({type: 'compileResult', ok: true}),
      play: jest.fn().mockResolvedValue({
        type: 'renderResult',
        ok: true,
        metrics: {
          compileMs: 2,
          firstFrameMs: 4,
          frameCount: 20,
          droppedFrameCount: 0,
          runtimeErrorCount: 0,
        },
      }),
      seek: jest
        .fn()
        .mockResolvedValue({type: 'frameResult', ok: true, currentTime: 0}),
      captureFrame: jest
        .fn()
        .mockResolvedValue('data:image/png;base64,ZmFrZQ=='),
    } as unknown as InAppRendererController;

    const result = await runInAppVisualization({request, model, renderer});

    expect(result.phase).toBe('completed');
    expect(renderer.loadProgram).toHaveBeenCalledTimes(1);
    expect(renderer.play).toHaveBeenCalledTimes(1);
    expect(renderer.captureFrame).toHaveBeenCalledTimes(3);
    expect(model.completeJson).toHaveBeenCalledTimes(4);
  });
});
