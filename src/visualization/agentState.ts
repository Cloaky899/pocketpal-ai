import {
  MAX_REPAIR_ATTEMPTS,
  type AgentEvent,
  type AgentPhase,
  type AgentState,
} from './types';

export class InvalidAgentTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentTransitionError';
  }
}

export function createAgentState(request: AgentState['request']): AgentState {
  return {
    request,
    phase: 'idle',
    repairAttempt: 0,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
  };
}

function requirePhase(
  state: AgentState,
  allowed: AgentPhase[],
  event: AgentEvent['type'],
): void {
  if (!allowed.includes(state.phase)) {
    throw new InvalidAgentTransitionError(
      `Cannot process ${event} while agent is in ${state.phase}.`,
    );
  }
}

export function transitionAgentState(
  state: AgentState,
  event: AgentEvent,
): AgentState {
  switch (event.type) {
    case 'start':
      requirePhase(state, ['idle'], event.type);
      return {...state, phase: 'planning', error: undefined};
    case 'scene-plan-ready':
      requirePhase(state, ['planning'], event.type);
      return {
        ...state,
        phase: 'generating',
        scenePlan: event.scenePlan,
        error: undefined,
      };
    case 'program-ready':
      requirePhase(state, ['generating', 'repairing'], event.type);
      return {
        ...state,
        phase: 'validating',
        program: event.program,
        error: undefined,
      };
    case 'validation-failed':
      requirePhase(state, ['validating'], event.type);
      if (state.repairAttempt >= MAX_REPAIR_ATTEMPTS) {
        return {
          ...state,
          phase: 'failed',
          error: event.message,
        };
      }
      return {
        ...state,
        phase: 'repairing',
        repairAttempt: state.repairAttempt + 1,
        error: event.message,
      };
    case 'preview-submitted':
      requirePhase(state, ['validating'], event.type);
      return {
        ...state,
        phase: 'rendering-preview',
        renderJob: event.renderJob,
        error: undefined,
      };
    case 'preview-succeeded':
      requirePhase(state, ['rendering-preview'], event.type);
      return {
        ...state,
        phase: 'reviewing',
        renderJob: event.renderJob,
        error: undefined,
      };
    case 'review-ready':
      requirePhase(state, ['reviewing'], event.type);
      if (event.review.needsRevision) {
        if (state.repairAttempt >= MAX_REPAIR_ATTEMPTS) {
          return {
            ...state,
            phase: 'failed',
            review: event.review,
            error:
              'The visualization did not pass review after the maximum repair attempts.',
          };
        }
        return {
          ...state,
          phase: 'repairing',
          repairAttempt: state.repairAttempt + 1,
          review: event.review,
        };
      }
      return {
        ...state,
        phase: 'rendering-final',
        review: event.review,
        error: undefined,
      };
    case 'repair-failed':
      requirePhase(state, ['repairing'], event.type);
      return {
        ...state,
        phase: 'failed',
        error: event.message,
      };
    case 'final-submitted':
      requirePhase(state, ['rendering-final'], event.type);
      return {
        ...state,
        phase: 'rendering-final',
        renderJob: event.renderJob,
        error: undefined,
      };
    case 'final-succeeded':
      requirePhase(state, ['rendering-final'], event.type);
      return {
        ...state,
        phase: 'completed',
        renderJob: event.renderJob,
        artifacts: event.artifacts,
        error: undefined,
      };
    case 'failed':
      requirePhase(
        state,
        [
          'planning',
          'generating',
          'validating',
          'rendering-preview',
          'reviewing',
          'repairing',
          'rendering-final',
        ],
        event.type,
      );
      return {...state, phase: 'failed', error: event.message};
    case 'cancel':
      requirePhase(
        state,
        [
          'planning',
          'generating',
          'validating',
          'rendering-preview',
          'reviewing',
          'repairing',
          'rendering-final',
        ],
        event.type,
      );
      return {...state, phase: 'cancelled', error: undefined};
  }
}
