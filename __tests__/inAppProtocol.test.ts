import {
  IN_APP_RENDERER_PROTOCOL_VERSION,
  parseInAppEvent,
  serializeInAppCommand,
} from '../src/visualization/inAppProtocol';

describe('in-app renderer protocol', () => {
  it('parses a valid ready event', () => {
    expect(
      parseInAppEvent({
        protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
        type: 'ready',
        runId: null,
        sequence: 1,
        engine: 'manim-web',
        engineVersion: '0.3.24',
      }),
    ).toMatchObject({type: 'ready', sequence: 1});
  });

  it('rejects unsupported and unknown events', () => {
    expect(() =>
      parseInAppEvent({
        protocolVersion: 99,
        type: 'ready',
        sequence: 1,
      }),
    ).toThrow('Unsupported renderer protocol version');
    expect(() =>
      parseInAppEvent({
        protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
        type: 'unknown',
        sequence: 1,
      }),
    ).toThrow('Unknown renderer event type');
  });

  it('serializes a JSON-only load command', () => {
    const serialized = serializeInAppCommand({
      protocolVersion: IN_APP_RENDERER_PROTOCOL_VERSION,
      type: 'loadProgram',
      runId: 'run-1',
      bundle: {
        schemaVersion: 1,
        requestId: 'request-1',
        engine: 'manim-web',
        aspectRatio: '16:9',
        backgroundColor: '#1c1c1c',
        scenes: [],
        totalDurationSeconds: 0,
        contentHash: '00000000',
      },
    });
    expect(JSON.parse(serialized)).toMatchObject({
      type: 'loadProgram',
      runId: 'run-1',
    });
  });
});
