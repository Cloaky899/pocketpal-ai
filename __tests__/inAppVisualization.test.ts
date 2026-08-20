import {
  compileVisualizationProgram,
  hashVisualizationProgram,
} from '../src/visualization/dslCompiler';
import {validateVisualizationProgram} from '../src/visualization/inAppValidation';
import type {VisualizationProgram} from '../src/visualization/inAppTypes';

const validProgram: VisualizationProgram = {
  schemaVersion: 1,
  requestId: 'request-in-app-1',
  engine: 'manim-web',
  aspectRatio: '16:9',
  backgroundColor: '#1c1c1c',
  scenes: [
    {
      sceneId: 'vectors',
      title: 'A rotating vector',
      durationSeconds: 4,
      primitives: [
        {kind: 'axes', id: 'axes', xLength: 8, yLength: 5},
        {
          kind: 'arrow',
          id: 'vector',
          start: [0, 0],
          end: [2, 1],
          color: '#4da6ff',
        },
        {
          kind: 'text',
          id: 'label',
          text: 'Vector',
          position: [0, 2.5],
          fontSize: 0.5,
        },
      ],
      animations: [
        {kind: 'create', targetId: 'axes', durationSeconds: 0.5},
        {kind: 'create', targetId: 'vector', durationSeconds: 0.75},
        {kind: 'write', targetId: 'label', durationSeconds: 0.75},
        {
          kind: 'rotate',
          targetId: 'vector',
          angleRadians: 1.57,
          durationSeconds: 1,
        },
        {kind: 'wait', durationSeconds: 0.5},
      ],
    },
  ],
};

describe('in-app visualization DSL', () => {
  it('validates and compiles a supported program deterministically', () => {
    const validated = validateVisualizationProgram(validProgram);
    const first = compileVisualizationProgram(validated);
    const second = compileVisualizationProgram(
      JSON.parse(JSON.stringify(validProgram)),
    );

    expect(first).toEqual(second);
    expect(first.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(hashVisualizationProgram(validProgram)).toBe(
      hashVisualizationProgram(JSON.parse(JSON.stringify(validProgram))),
    );
    expect(first.scenes[0]?.animations[1]?.startSeconds).toBe(0.5);
    expect(first.scenes[0]?.primitives[0]?.position).toEqual([0, 0]);
  });

  it('rejects executable or unrecognized fields before compilation', () => {
    expect(() =>
      validateVisualizationProgram({
        ...validProgram,
        scenes: [
          {
            ...validProgram.scenes[0],
            primitives: [
              {
                kind: 'text',
                id: 'unsafe',
                text: 'x',
                rawCode: 'eval("danger")',
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects unknown animation targets and budget overruns', () => {
    expect(() =>
      validateVisualizationProgram({
        ...validProgram,
        scenes: [
          {
            ...validProgram.scenes[0],
            animations: [{kind: 'fade-in', targetId: 'missing'}],
          },
        ],
      }),
    ).toThrow('Unknown animation target');

    expect(() =>
      validateVisualizationProgram({
        ...validProgram,
        scenes: [
          {
            ...validProgram.scenes[0],
            durationSeconds: 1,
            animations: [
              {kind: 'create', targetId: 'axes', durationSeconds: 2},
            ],
          },
        ],
      }),
    ).toThrow('animation duration exceeds scene budget');
  });
});
