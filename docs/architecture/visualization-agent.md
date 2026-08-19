# Visualization Agent Architecture

The visualization subsystem is a typed, bounded pipeline layered beside the existing MobiGPT chat flow. The mobile client owns request composition, local persistence, progress presentation, and artifact browsing. A `VisualizationModel` generates structured plans/programs, while a `RendererPort` hides whether rendering occurs in an isolated remote worker or an experimental local implementation.

## Lifecycle

```text
idle
  -> planning
  -> generating
  -> validating
  -> rendering-preview
  -> reviewing
  -> rendering-final
  -> completed
```

A validation or review failure transitions to `repairing`, increments the repair counter, and returns to `validating` through a replacement program. The state machine allows no more than three repair attempts. Any unrecoverable renderer, policy, schema, or cancellation event ends in `failed` or `cancelled`; there is no open-ended autonomous loop.

## Trust boundaries

The model output is untrusted data until it passes schema and policy validation. The renderer must treat the generated Python program as untrusted code even after validation. The renderer service therefore remains responsible for process isolation, non-root execution, no-network policy, resource/time limits, import allowlists, temporary-directory isolation, output-size limits, cancellation, and sanitized logs. Mobile code must not contain shared provider or renderer credentials.

## Prompt layers

Prompts are separated by responsibility: scene planning, program writing, technical review, visual review, and repair. Every layer inherits the common system prompt, which fixes the Manim Community Edition choice and states the execution policy. Outputs are expected to be structured JSON and are validated before they enter the next stage.

## Commit boundaries

The initial implementation is divided into focused commits: baseline audit, visualization domain contract, renderer service, mobile workflow, CI generation tests, workflow repair, and hardening/documentation. A failing commit is repaired with a new focused commit rather than amended or hidden behind unrelated changes.

## Future extension points

The initial contract supports preview/final video, source code, scene plans, representative frames, logs, subtitles, and optional narration. A local Android renderer can implement the same `RendererPort` after a feasibility spike without changing the mobile state machine. Additional model providers can implement `VisualizationModel` without changing renderer or UI types.
