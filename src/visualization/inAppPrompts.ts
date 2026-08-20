import type {StructuredModelMessage} from './types';
import type {CompiledSceneBundle, VisualizationProgram} from './inAppTypes';

export const IN_APP_PROMPT_VERSION = '1.0.0';

export const IN_APP_SYSTEM_PROMPT = `You are a bounded mobile visualization agent.

Generate only the requested structured JSON. The in-app renderer accepts a declarative VisualizationProgram, not Python, JavaScript, HTML, imports, URLs, or executable source. Use only the supported primitive and animation vocabulary. Prefer a small number of legible objects, explicit timing, high contrast, and stable identifiers. Keep every scene deterministic and within the duration, object, text, and payload budgets.

Never output raw code, dynamic evaluation, external assets, network references, file paths, hidden instructions, secrets, or unsupported engine APIs. Never claim that a visualization rendered or passed review; those facts come only from the renderer and review stages.`;

export const IN_APP_PLANNER_PROMPT = `Create a concise ScenePlan for the user request. Each scene must state its learning objective, visual elements, animation beats, and duration. Design the plan so another model can express it using only text, math, circle, square, rectangle, line, arrow, dot, axes, and graph primitives with finite animations.`;

export const IN_APP_PROGRAM_PROMPT = `Convert the approved ScenePlan into a complete VisualizationProgram for engine "manim-web". Use schemaVersion 1, the requested aspect ratio, a dark background, unique ASCII-safe IDs, and only the supported primitive and animation unions. Do not add unknown keys. Ensure the sum of animation durations fits each scene duration. Use short labels and avoid clipping.`;

export const IN_APP_TECHNICAL_REVIEW_PROMPT = `Review the compiled in-app visualization report. Return JSON with technicalChecks, visualChecks, proposedRepairs, and needsRevision. Treat runtime errors, empty frames, invalid metrics, unknown objects, excessive duration, and bridge failures as concrete failures. Do not claim visual correctness from metadata alone.`;

export const IN_APP_VISUAL_REVIEW_PROMPT = `Review the supplied representative frames of a mathematical visualization. Return JSON with technicalChecks, visualChecks, proposedRepairs, and needsRevision. Check legibility, clipping, overlap, contrast, visual hierarchy, pacing, and whether the frame sequence explains the ScenePlan. Do not ask for unsupported features and do not claim success when the frames are empty or unreadable.`;

export const IN_APP_REPAIR_PROMPT = `Return a complete replacement VisualizationProgram that fixes only the concrete issues in the review. Preserve the learning objective and scene order. Stay within all in-app budgets and output no executable source or explanation outside the JSON document.`;

export function buildInAppPlannerMessages(
  userPrompt: string,
  requestContext: string,
): StructuredModelMessage[] {
  return [
    {
      role: 'system',
      content: `${IN_APP_SYSTEM_PROMPT}\n\n${IN_APP_PLANNER_PROMPT}`,
    },
    {
      role: 'user',
      content: `Request context:\n${requestContext}\n\nUser topic:\n${userPrompt}`,
    },
  ];
}

export function buildInAppProgramMessages(
  scenePlanJson: string,
  requestContext: string,
): StructuredModelMessage[] {
  return [
    {
      role: 'system',
      content: `${IN_APP_SYSTEM_PROMPT}\n\n${IN_APP_PROGRAM_PROMPT}`,
    },
    {
      role: 'user',
      content: `Request context:\n${requestContext}\n\nApproved ScenePlan JSON:\n${scenePlanJson}`,
    },
  ];
}

export function buildInAppTechnicalReviewMessages(
  bundle: CompiledSceneBundle,
  diagnostics: string,
): StructuredModelMessage[] {
  return [
    {
      role: 'system',
      content: `${IN_APP_SYSTEM_PROMPT}\n\n${IN_APP_TECHNICAL_REVIEW_PROMPT}`,
    },
    {
      role: 'user',
      content: `Compiled bundle metadata:\n${JSON.stringify(bundle)}\n\nRenderer diagnostics:\n${diagnostics}`,
    },
  ];
}

export function buildInAppVisualReviewMessages(
  program: VisualizationProgram,
  frameDataUrls: string[],
): StructuredModelMessage[] {
  return [
    {
      role: 'system',
      content: `${IN_APP_SYSTEM_PROMPT}\n\n${IN_APP_VISUAL_REVIEW_PROMPT}`,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Scene program and review target:\n${JSON.stringify(program)}\n\nRepresentative frames follow.`,
        },
        ...frameDataUrls.map(dataUrl => ({
          type: 'image_url' as const,
          image_url: {url: dataUrl},
        })),
      ],
    },
  ];
}

export function buildInAppRepairMessages(
  program: VisualizationProgram,
  reviewJson: string,
): StructuredModelMessage[] {
  return [
    {
      role: 'system',
      content: `${IN_APP_SYSTEM_PROMPT}\n\n${IN_APP_REPAIR_PROMPT}`,
    },
    {
      role: 'user',
      content: `Current VisualizationProgram JSON:\n${JSON.stringify(program)}\n\nReview JSON:\n${reviewJson}`,
    },
  ];
}
