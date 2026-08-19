# CI Diagnosis: Manim Generation Setup

## Observed run

The first generation workflow run on commit `23475fab7eb9ebe1ffb6244cb3da8c42d684969c` was [run 32297696359](https://github.com/Cloaky899/pocketpal-ai/actions/runs/32297696359). It remained in progress for more than eight minutes in `Install system rendering dependencies`, before being cancelled to avoid spending the full job timeout.

The run did not expose a completed log, so the precise package-manager subcommand was unavailable. The evidence is sufficient to classify the root cause as **unbounded or excessively slow Manim environment provisioning**, not a generated-program, TypeScript, or policy failure. The local sandbox reproduced the same architectural risk: the generic Manim setup script expected an unavailable `python3.11-dev` package on the Python 3.12 image and required a fallback package list.

## Repair

The workflow was changed in a focused follow-up commit to use the maintained `manimcommunity/manim:v0.19.1` container image. The JavaScript contract checks now run in their own native Node job, while Python policy tests, fixture rendering, FFmpeg frame extraction, and the optional live provider smoke test run inside the pinned Manim image. This removes the slow `apt-get` and `pip install manim` path from GitHub Actions and keeps the runtime aligned with the renderer container.

The live smoke script was also changed to include a short sanitized diagnostic on render failure. It never emits generated source, prompts, authorization headers, or API keys. During the repair loop, two live-generation failures were reproduced and fixed:

1. A model response was not valid JSON even though the prompt requested JSON. The request now sets OpenAI-compatible `response_format: {"type": "json_object"}` and the parser retains a fenced/substring fallback for compatible gateways.
2. A generated scene used `MathTex`, but the local smoke environment did not include the optional `latex` executable. The baseline fixture prompt now explicitly avoids `Tex`/`MathTex` and uses `Text` plus vector primitives. The production renderer Dockerfile includes the LaTeX packages required for mathematical scenes.

After these focused fixes, the built-in OpenAI-compatible API with `gpt-5-mini` passed policy validation and local Manim rendering.

## Verification

The local checks after the repair were:

| Check                                 | Result                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Python renderer policy tests          | Passed, 4 tests                                                           |
| Local live prompt-to-Manim generation | Passed after JSON-mode and LaTeX-independent fixture fixes                |
| TypeScript typecheck                  | Passed                                                                    |
| ESLint                                | Passed with the existing informational `baseline-browser-mapping` warning |
| Jest                                  | Passed, 2 suites and 6 tests                                              |
| Workflow formatting                   | Passed with Prettier                                                      |

The next pushed run is the authoritative validation of the Docker-based GitHub Actions path. If it fails, inspect the first failing container step and apply a new focused corrective commit rather than changing unrelated mobile code.
