import {
  MANIM_FRAMEWORK,
  MAX_REPAIR_ATTEMPTS,
  VISUALIZATION_SCHEMA_VERSION,
  type ManimProgram,
  type RenderOptions,
  type ScenePlan,
  type VisualizationRequest,
} from './types';

export class VisualizationValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'VisualizationValidationError';
    this.issues = issues;
  }
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VisualizationValidationError(`${label} must be an object.`);
  }
}

function assertString(
  value: unknown,
  label: string,
  minLength = 1,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new VisualizationValidationError(
      `${label} must be a non-empty string.`,
    );
  }
}

function assertFiniteNumber(
  value: unknown,
  label: string,
  minimum = 0,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new VisualizationValidationError(
      `${label} must be a finite number >= ${minimum}.`,
    );
  }
}

function assertStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some(item => typeof item !== 'string' || !item.trim())
  ) {
    throw new VisualizationValidationError(
      `${label} must be an array of non-empty strings.`,
    );
  }
}

export function validateVisualizationRequest(
  value: unknown,
): VisualizationRequest {
  assertObject(value, 'VisualizationRequest');
  if (value.schemaVersion !== VISUALIZATION_SCHEMA_VERSION) {
    throw new VisualizationValidationError(
      'Unsupported VisualizationRequest schema version.',
    );
  }
  assertString(value.requestId, 'requestId');
  assertString(value.prompt, 'prompt', 3);
  if (
    !['beginner', 'intermediate', 'advanced'].includes(String(value.audience))
  ) {
    throw new VisualizationValidationError('audience is invalid.');
  }
  if (!['16:9', '9:16', '1:1'].includes(String(value.aspectRatio))) {
    throw new VisualizationValidationError('aspectRatio is invalid.');
  }
  assertFiniteNumber(value.durationSeconds, 'durationSeconds', 1);
  if (value.durationSeconds > 600) {
    throw new VisualizationValidationError('durationSeconds must be <= 600.');
  }
  if (!['preview', 'high'].includes(String(value.quality))) {
    throw new VisualizationValidationError('quality is invalid.');
  }
  if (
    !['none', 'subtitles', 'voice-and-subtitles'].includes(
      String(value.narration),
    )
  ) {
    throw new VisualizationValidationError('narration is invalid.');
  }
  if (!['local-first', 'remote-renderer'].includes(String(value.privacyMode))) {
    throw new VisualizationValidationError('privacyMode is invalid.');
  }
  if (value.model !== undefined) assertString(value.model, 'model');
  if (value.systemPrompt !== undefined)
    assertString(value.systemPrompt, 'systemPrompt');
  return value as VisualizationRequest;
}

export function validateScenePlan(value: unknown): ScenePlan {
  assertObject(value, 'ScenePlan');
  if (value.schemaVersion !== VISUALIZATION_SCHEMA_VERSION) {
    throw new VisualizationValidationError(
      'Unsupported ScenePlan schema version.',
    );
  }
  assertString(value.requestId, 'requestId');
  assertString(value.title, 'title');
  assertString(value.summary, 'summary');
  if (
    !Array.isArray(value.scenes) ||
    value.scenes.length === 0 ||
    value.scenes.length > 12
  ) {
    throw new VisualizationValidationError(
      'scenes must contain 1 to 12 items.',
    );
  }
  for (const [index, rawScene] of value.scenes.entries()) {
    assertObject(rawScene, `scenes[${index}]`);
    assertString(rawScene.sceneId, `scenes[${index}].sceneId`);
    assertString(rawScene.title, `scenes[${index}].title`);
    assertString(
      rawScene.learningObjective,
      `scenes[${index}].learningObjective`,
    );
    assertStringArray(
      rawScene.visualElements,
      `scenes[${index}].visualElements`,
    );
    assertStringArray(
      rawScene.animationBeats,
      `scenes[${index}].animationBeats`,
    );
    assertFiniteNumber(
      rawScene.durationSeconds,
      `scenes[${index}].durationSeconds`,
      0.1,
    );
    assertObject(rawScene.technicalNotes, `scenes[${index}].technicalNotes`);
    if (rawScene.technicalNotes.framework !== MANIM_FRAMEWORK) {
      throw new VisualizationValidationError(
        `scenes[${index}] must use Manim Community Edition.`,
      );
    }
    assertStringArray(
      rawScene.technicalNotes.requiredImports,
      `scenes[${index}].technicalNotes.requiredImports`,
    );
  }
  assertFiniteNumber(value.totalDurationSeconds, 'totalDurationSeconds', 0.1);
  return value as ScenePlan;
}

const DISALLOWED_IMPORTS = new Set([
  'os',
  'subprocess',
  'socket',
  'requests',
  'urllib',
  'httpx',
  'pathlib',
  'shutil',
]);

export function validateManimProgram(value: unknown): ManimProgram {
  assertObject(value, 'ManimProgram');
  if (value.schemaVersion !== VISUALIZATION_SCHEMA_VERSION) {
    throw new VisualizationValidationError(
      'Unsupported ManimProgram schema version.',
    );
  }
  assertString(value.requestId, 'requestId');
  if (value.framework !== MANIM_FRAMEWORK) {
    throw new VisualizationValidationError(
      'Only Manim Community Edition is supported.',
    );
  }
  assertString(value.entrypoint, 'entrypoint');
  assertStringArray(value.sceneNames, 'sceneNames');
  assertString(value.code, 'code', 20);
  assertStringArray(value.imports, 'imports');
  for (const imported of value.imports) {
    const root = imported.trim().split('.')[0];
    if (DISALLOWED_IMPORTS.has(root)) {
      throw new VisualizationValidationError(`Disallowed import: ${root}.`);
    }
  }
  if (
    value.code.includes('subprocess') ||
    value.code.includes('__import__') ||
    value.code.includes('eval(')
  ) {
    throw new VisualizationValidationError(
      'Program contains a disallowed execution primitive.',
    );
  }
  return value as ManimProgram;
}

export function validateRenderOptions(value: unknown): RenderOptions {
  assertObject(value, 'RenderOptions');
  if (!['low', 'high'].includes(String(value.quality))) {
    throw new VisualizationValidationError('RenderOptions.quality is invalid.');
  }
  assertFiniteNumber(value.timeoutSeconds, 'timeoutSeconds', 1);
  if (value.timeoutSeconds > 900) {
    throw new VisualizationValidationError('timeoutSeconds must be <= 900.');
  }
  if (!['16:9', '9:16', '1:1'].includes(String(value.aspectRatio))) {
    throw new VisualizationValidationError(
      'RenderOptions.aspectRatio is invalid.',
    );
  }
  if (typeof value.includeSubtitles !== 'boolean') {
    throw new VisualizationValidationError(
      'includeSubtitles must be a boolean.',
    );
  }
  return value as RenderOptions;
}

export function isRepairAttemptAllowed(attempt: number): boolean {
  return (
    Number.isInteger(attempt) && attempt >= 0 && attempt < MAX_REPAIR_ATTEMPTS
  );
}
