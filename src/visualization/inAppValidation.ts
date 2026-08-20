import {
  IN_APP_ENGINE,
  IN_APP_VISUALIZATION_SCHEMA_VERSION,
  type InAppAnimation,
  type InAppPrimitive,
  type InAppScene,
  type VisualizationProgram,
} from './inAppTypes';
import {VisualizationValidationError} from './validation';

export const IN_APP_LIMITS = {
  maxScenes: 6,
  maxPrimitivesPerScene: 40,
  maxAnimationsPerScene: 60,
  maxTextCharacters: 600,
  maxLatexCharacters: 400,
  maxDurationSeconds: 120,
  maxPayloadBytes: 120_000,
  maxCoordinate: 20,
  maxScaleFactor: 8,
  maxRotationRadians: Math.PI * 16,
} as const;

const PRIMITIVE_KINDS = new Set([
  'text',
  'math',
  'circle',
  'square',
  'rectangle',
  'line',
  'arrow',
  'dot',
  'axes',
  'graph',
]);

const ANIMATION_KINDS = new Set([
  'create',
  'write',
  'fade-in',
  'fade-out',
  'transform',
  'move-to',
  'shift',
  'rotate',
  'scale',
  'wait',
]);

const EASINGS = new Set(['linear', 'smooth', 'there-and-back', 'rush-from']);
const EXPRESSIONS = new Set([
  'sin',
  'cos',
  'tan',
  'quadratic',
  'linear',
  'sqrt',
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VisualizationValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VisualizationValidationError(
      `${label} must be a non-empty string.`,
    );
  }
  if (value.length > maxLength) {
    throw new VisualizationValidationError(
      `${label} exceeds ${maxLength} characters.`,
    );
  }
  return value;
}

function number(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new VisualizationValidationError(
      `${label} must be finite and within [${minimum}, ${maximum}].`,
    );
  }
  return value;
}

function optionalNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return value === undefined
    ? fallback
    : number(value, label, minimum, maximum);
}

function vector(value: unknown, label: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new VisualizationValidationError(
      `${label} must be a two-number vector.`,
    );
  }
  return [
    number(
      value[0],
      `${label}[0]`,
      -IN_APP_LIMITS.maxCoordinate,
      IN_APP_LIMITS.maxCoordinate,
    ),
    number(
      value[1],
      `${label}[1]`,
      -IN_APP_LIMITS.maxCoordinate,
      IN_APP_LIMITS.maxCoordinate,
    ),
  ];
}

function optionalVector(
  value: unknown,
  label: string,
  fallback: readonly [number, number],
): readonly [number, number] {
  return value === undefined ? fallback : vector(value, label);
}

function color(value: unknown, label: string, fallback: string): string {
  if (value === undefined) return fallback;
  const result = string(value, label, 32).trim();
  if (!/^#[0-9a-f]{3,8}$/i.test(result) && !/^[a-z]+$/i.test(result)) {
    throw new VisualizationValidationError(
      `${label} must be a CSS color token.`,
    );
  }
  return result;
}

function validatePrimitive(value: unknown, index: number): InAppPrimitive {
  const raw = object(value, `primitives[${index}]`);
  const kind = string(raw.kind, `primitives[${index}].kind`, 20);
  if (!PRIMITIVE_KINDS.has(kind)) {
    throw new VisualizationValidationError(
      `Unsupported primitive kind: ${kind}.`,
    );
  }
  const id = string(raw.id, `primitives[${index}].id`, 64);
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
    throw new VisualizationValidationError(`Invalid primitive id: ${id}.`);
  }
  const position = optionalVector(
    raw.position,
    `primitives[${index}].position`,
    [0, 0],
  );

  if (kind === 'text') {
    return {
      kind,
      id,
      text: string(
        raw.text,
        `primitives[${index}].text`,
        IN_APP_LIMITS.maxTextCharacters,
      ),
      position,
      fontSize: optionalNumber(raw.fontSize, 'fontSize', 0.1, 4, 0.5),
      color: color(raw.color, 'color', '#ffffff'),
    };
  }
  if (kind === 'math') {
    const latex = string(
      raw.latex,
      `primitives[${index}].latex`,
      IN_APP_LIMITS.maxLatexCharacters,
    );
    if (/[<>`]|\\(?:input|include|write18)/i.test(latex)) {
      throw new VisualizationValidationError(
        `primitives[${index}].latex contains a disallowed token.`,
      );
    }
    return {
      kind,
      id,
      latex,
      position,
      fontSize: optionalNumber(raw.fontSize, 'fontSize', 0.1, 4, 0.5),
      color: color(raw.color, 'color', '#ffffff'),
    };
  }
  if (kind === 'circle') {
    return {
      kind,
      id,
      radius: optionalNumber(raw.radius, 'radius', 0.05, 10, 1),
      position,
      color: color(raw.color, 'color', '#ffffff'),
      fillColor:
        raw.fillColor === undefined
          ? undefined
          : color(raw.fillColor, 'fillColor', '#ffffff'),
      fillOpacity:
        raw.fillOpacity === undefined
          ? undefined
          : number(raw.fillOpacity, 'fillOpacity', 0, 1),
    };
  }
  if (kind === 'square') {
    return {
      kind,
      id,
      sideLength: optionalNumber(raw.sideLength, 'sideLength', 0.05, 10, 2),
      position,
      color: color(raw.color, 'color', '#ffffff'),
      fillColor:
        raw.fillColor === undefined
          ? undefined
          : color(raw.fillColor, 'fillColor', '#ffffff'),
      fillOpacity:
        raw.fillOpacity === undefined
          ? undefined
          : number(raw.fillOpacity, 'fillOpacity', 0, 1),
    };
  }
  if (kind === 'rectangle') {
    return {
      kind,
      id,
      width: optionalNumber(raw.width, 'width', 0.05, 14, 2),
      height: optionalNumber(raw.height, 'height', 0.05, 8, 1),
      position,
      color: color(raw.color, 'color', '#ffffff'),
      fillColor:
        raw.fillColor === undefined
          ? undefined
          : color(raw.fillColor, 'fillColor', '#ffffff'),
      fillOpacity:
        raw.fillOpacity === undefined
          ? undefined
          : number(raw.fillOpacity, 'fillOpacity', 0, 1),
    };
  }
  if (kind === 'line' || kind === 'arrow') {
    return {
      kind,
      id,
      start: vector(raw.start, `primitives[${index}].start`),
      end: vector(raw.end, `primitives[${index}].end`),
      color: color(raw.color, 'color', '#ffffff'),
      strokeWidth: optionalNumber(
        raw.strokeWidth,
        'strokeWidth',
        0.01,
        1,
        0.04,
      ),
    };
  }
  if (kind === 'dot') {
    return {
      kind,
      id,
      position,
      radius: optionalNumber(raw.radius, 'radius', 0.01, 1, 0.08),
      color: color(raw.color, 'color', '#ffffff'),
    };
  }
  if (kind === 'axes') {
    return {
      kind,
      id,
      xRange:
        raw.xRange === undefined ? undefined : range3(raw.xRange, 'xRange'),
      yRange:
        raw.yRange === undefined ? undefined : range3(raw.yRange, 'yRange'),
      xLength: optionalNumber(raw.xLength, 'xLength', 1, 14, 10),
      yLength: optionalNumber(raw.yLength, 'yLength', 1, 8, 6),
      color: color(raw.color, 'color', '#888888'),
    };
  }
  return {
    kind: 'graph',
    id,
    expression: expression(raw.expression, `primitives[${index}].expression`),
    xRange: raw.xRange === undefined ? undefined : range2(raw.xRange, 'xRange'),
    color: color(raw.color, 'color', '#4da6ff'),
    strokeWidth: optionalNumber(raw.strokeWidth, 'strokeWidth', 0.01, 1, 0.04),
  };
}

function expression(
  value: unknown,
  label: string,
): InAppPrimitive & {expression: string} extends never
  ? never
  : 'sin' | 'cos' | 'tan' | 'quadratic' | 'linear' | 'sqrt' {
  const result = string(value, label, 20);
  if (!EXPRESSIONS.has(result)) {
    throw new VisualizationValidationError(`${label} is unsupported.`);
  }
  return result as 'sin' | 'cos' | 'tan' | 'quadratic' | 'linear' | 'sqrt';
}

function range2(value: unknown, label: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new VisualizationValidationError(
      `${label} must contain two numbers.`,
    );
  }
  const start = number(value[0], `${label}[0]`, -20, 20);
  const end = number(value[1], `${label}[1]`, -20, 20);
  if (end <= start)
    throw new VisualizationValidationError(`${label} must ascend.`);
  return [start, end];
}

function range3(
  value: unknown,
  label: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new VisualizationValidationError(
      `${label} must contain three numbers.`,
    );
  }
  const range = [
    number(value[0], `${label}[0]`, -20, 20),
    number(value[1], `${label}[1]`, -20, 20),
    number(value[2], `${label}[2]`, 0.01, 10),
  ] as const;
  if (range[1] <= range[0])
    throw new VisualizationValidationError(`${label} must ascend.`);
  return range;
}

function validateAnimation(value: unknown, index: number): InAppAnimation {
  const raw = object(value, `animations[${index}]`);
  const kind = string(raw.kind, `animations[${index}].kind`, 20);
  if (!ANIMATION_KINDS.has(kind)) {
    throw new VisualizationValidationError(
      `Unsupported animation kind: ${kind}.`,
    );
  }
  if (kind === 'wait') {
    return {
      kind,
      durationSeconds: number(raw.durationSeconds, 'durationSeconds', 0.05, 30),
    };
  }
  const targetId = string(raw.targetId, `animations[${index}].targetId`, 64);
  const durationSeconds = optionalNumber(
    raw.durationSeconds,
    `animations[${index}].durationSeconds`,
    0.05,
    30,
    kind === 'transform' ? 1 : 0.75,
  );
  const easing =
    raw.easing === undefined ? 'smooth' : string(raw.easing, 'easing', 20);
  if (!EASINGS.has(easing)) {
    throw new VisualizationValidationError(
      `animations[${index}].easing is unsupported.`,
    );
  }
  if (kind === 'transform') {
    return {
      kind,
      targetId,
      replacementId: string(raw.replacementId, 'replacementId', 64),
      durationSeconds,
      easing: easing as InAppAnimation extends {easing: infer E} ? E : never,
    } as InAppAnimation;
  }
  if (kind === 'move-to' || kind === 'shift') {
    return {
      kind,
      targetId,
      position: vector(raw.position, `animations[${index}].position`),
      durationSeconds,
      easing: easing as 'linear' | 'smooth' | 'there-and-back' | 'rush-from',
    };
  }
  if (kind === 'rotate') {
    return {
      kind,
      targetId,
      angleRadians: number(
        raw.angleRadians,
        'angleRadians',
        -Math.PI * 16,
        IN_APP_LIMITS.maxRotationRadians,
      ),
      durationSeconds,
      easing: easing as 'linear' | 'smooth' | 'there-and-back' | 'rush-from',
    };
  }
  if (kind === 'scale') {
    return {
      kind,
      targetId,
      factor: number(raw.factor, 'factor', 0.05, IN_APP_LIMITS.maxScaleFactor),
      durationSeconds,
      easing: easing as 'linear' | 'smooth' | 'there-and-back' | 'rush-from',
    };
  }
  return {
    kind: kind as 'create' | 'write' | 'fade-in' | 'fade-out',
    targetId,
    durationSeconds,
    easing: easing as 'linear' | 'smooth' | 'there-and-back' | 'rush-from',
  };
}

function validateScene(value: unknown, index: number): InAppScene {
  const raw = object(value, `scenes[${index}]`);
  const sceneId = string(raw.sceneId, `scenes[${index}].sceneId`, 64);
  const title = string(raw.title, `scenes[${index}].title`, 160);
  const durationSeconds = number(
    raw.durationSeconds,
    `scenes[${index}].durationSeconds`,
    0.1,
    IN_APP_LIMITS.maxDurationSeconds,
  );
  if (!Array.isArray(raw.primitives) || raw.primitives.length === 0) {
    throw new VisualizationValidationError(
      `scenes[${index}].primitives must be non-empty.`,
    );
  }
  if (raw.primitives.length > IN_APP_LIMITS.maxPrimitivesPerScene) {
    throw new VisualizationValidationError(
      `scenes[${index}] exceeds primitive budget.`,
    );
  }
  if (!Array.isArray(raw.animations) || raw.animations.length === 0) {
    throw new VisualizationValidationError(
      `scenes[${index}].animations must be non-empty.`,
    );
  }
  if (raw.animations.length > IN_APP_LIMITS.maxAnimationsPerScene) {
    throw new VisualizationValidationError(
      `scenes[${index}] exceeds animation budget.`,
    );
  }
  const primitives = raw.primitives.map(validatePrimitive);
  const ids = new Set<string>();
  for (const primitive of primitives) {
    if (ids.has(primitive.id)) {
      throw new VisualizationValidationError(
        `Duplicate primitive id: ${primitive.id}.`,
      );
    }
    ids.add(primitive.id);
  }
  const animations = raw.animations.map(validateAnimation);
  for (const animation of animations) {
    if ('targetId' in animation && !ids.has(animation.targetId)) {
      throw new VisualizationValidationError(
        `Unknown animation target: ${animation.targetId}.`,
      );
    }
    if (animation.kind === 'transform' && !ids.has(animation.replacementId)) {
      throw new VisualizationValidationError(
        `Unknown transform replacement: ${animation.replacementId}.`,
      );
    }
  }
  const animationDuration = animations.reduce(
    (total, animation) => total + (animation.durationSeconds ?? 0),
    0,
  );
  if (animationDuration > durationSeconds + 0.25) {
    throw new VisualizationValidationError(
      `scenes[${index}] animation duration exceeds scene budget.`,
    );
  }
  return {sceneId, title, durationSeconds, primitives, animations};
}

export function validateVisualizationProgram(
  value: unknown,
): VisualizationProgram {
  const raw = object(value, 'VisualizationProgram');
  if (raw.schemaVersion !== IN_APP_VISUALIZATION_SCHEMA_VERSION) {
    throw new VisualizationValidationError(
      'Unsupported in-app visualization schema version.',
    );
  }
  if (raw.engine !== IN_APP_ENGINE) {
    throw new VisualizationValidationError(
      'Unsupported in-app visualization engine.',
    );
  }
  const requestId = string(raw.requestId, 'requestId', 128);
  const aspectRatio = string(raw.aspectRatio, 'aspectRatio', 10);
  if (!['16:9', '9:16', '1:1'].includes(aspectRatio)) {
    throw new VisualizationValidationError('Invalid aspect ratio.');
  }
  const backgroundColor = color(
    raw.backgroundColor,
    'backgroundColor',
    '#1c1c1c',
  );
  if (
    !Array.isArray(raw.scenes) ||
    raw.scenes.length === 0 ||
    raw.scenes.length > IN_APP_LIMITS.maxScenes
  ) {
    throw new VisualizationValidationError(
      `scenes must contain 1 to ${IN_APP_LIMITS.maxScenes} items.`,
    );
  }
  const scenes = raw.scenes.map(validateScene);
  const totalDurationSeconds = scenes.reduce(
    (total, scene) => total + scene.durationSeconds,
    0,
  );
  if (totalDurationSeconds > IN_APP_LIMITS.maxDurationSeconds) {
    throw new VisualizationValidationError(
      'Program duration exceeds the in-app budget.',
    );
  }
  const serialized = JSON.stringify(value);
  const payloadBytes = encodeURIComponent(serialized).replace(
    /%[0-9A-F]{2}/g,
    'x',
  ).length;
  if (payloadBytes > IN_APP_LIMITS.maxPayloadBytes) {
    throw new VisualizationValidationError(
      'Program payload exceeds the in-app size budget.',
    );
  }
  return {
    schemaVersion: IN_APP_VISUALIZATION_SCHEMA_VERSION,
    requestId,
    engine: IN_APP_ENGINE,
    aspectRatio: aspectRatio as VisualizationProgram['aspectRatio'],
    backgroundColor,
    scenes,
  };
}
