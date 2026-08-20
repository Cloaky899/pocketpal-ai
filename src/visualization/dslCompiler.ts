import {
  type CompiledAnimation,
  type CompiledPrimitive,
  type CompiledScene,
  type CompiledSceneBundle,
  type InAppAnimation,
  type InAppPrimitive,
  type VisualizationProgram,
} from './inAppTypes';
import {validateVisualizationProgram} from './inAppValidation';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashContent(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 16777619 + value.charCodeAt(index)) % 4294967296;
  }
  return Math.floor(hash).toString(16).padStart(8, '0');
}

function compilePrimitive(primitive: InAppPrimitive): CompiledPrimitive {
  return {
    ...primitive,
    position:
      'position' in primitive && primitive.position
        ? primitive.position
        : ([0, 0] as const),
  } as CompiledPrimitive;
}

function compileAnimation(
  animation: InAppAnimation,
  startSeconds: number,
): CompiledAnimation {
  return {
    ...animation,
    durationSeconds: animation.durationSeconds ?? 0.75,
    easing:
      'easing' in animation && animation.easing ? animation.easing : 'smooth',
    startSeconds,
  } as CompiledAnimation;
}

function compileScene(
  scene: VisualizationProgram['scenes'][number],
): CompiledScene {
  let startSeconds = 0;
  const animations = scene.animations.map(animation => {
    const compiled = compileAnimation(animation, startSeconds);
    startSeconds += compiled.durationSeconds;
    return compiled;
  });
  return {
    sceneId: scene.sceneId,
    title: scene.title,
    durationSeconds: scene.durationSeconds,
    primitives: scene.primitives.map(compilePrimitive),
    animations,
  };
}

export function compileVisualizationProgram(
  value: unknown,
): CompiledSceneBundle {
  const program = validateVisualizationProgram(value);
  const scenes = program.scenes.map(compileScene);
  const bundleWithoutHash = {
    schemaVersion: program.schemaVersion,
    requestId: program.requestId,
    engine: program.engine,
    aspectRatio: program.aspectRatio,
    backgroundColor: program.backgroundColor,
    scenes,
    totalDurationSeconds: scenes.reduce(
      (total, scene) => total + scene.durationSeconds,
      0,
    ),
  };
  return {
    ...bundleWithoutHash,
    contentHash: hashContent(stableJson(bundleWithoutHash)),
  };
}

export function hashVisualizationProgram(value: unknown): string {
  return hashContent(stableJson(validateVisualizationProgram(value)));
}
