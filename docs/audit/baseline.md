# Baseline Audit

## Scope

This audit covers the requested PocketPal snapshot at commit `9f1488d07caf84318072f99c521360072a736f9c`, the newly created user fork, the attached `/home/ubuntu/upload/src.zip`, the local baseline checks, and recent upstream GitHub Actions results.

## Repository and branch state

The requested repository is a public fork owned by `BinaryRahul`, with upstream `a-ghorbani/pocketpal-ai`. A user-owned fork was created at `https://github.com/Cloaky899/pocketpal-ai`. The working clone is `/home/ubuntu/pocketpal-ai`, with `origin` pointing to the user fork and `upstream` pointing to `BinaryRahul/pocketpal-ai`.

The implementation branch is `manim-agent`, checked out at the requested commit:

- Commit: `9f1488d07caf84318072f99c521360072a736f9c`
- Subject: `fix(android): keep React Native inspector startup classes`
- Pinned tree: `4a00d381921a42cd633c599681229156ee920c82`
- Repository default branch: `pocketpal-lite`
- Upstream feature branch containing the pinned commit: `openai-only-clean`

The working tree was clean before this audit change.

## Current application architecture

The pinned tree is a deliberately small React Native application named **MobiGPT**, rather than the full historical PocketPal product. Its README states that it is an OpenAI-compatible mobile chat client and that local GGUF models, llama.cpp, model downloads, PalsHub, TTS, image analysis, Firebase, and related native/service layers were removed.

The current integration seams are:

| Area | Current implementation | Extension point |
|---|---|---|
| Mobile shell | `App.tsx` contains the single-screen chat UI, settings, conversation list, and composer | Add a visualization workspace without replacing the existing chat transport |
| Provider transport | `src/api/openai.ts` uses `react-native-sse` and OpenAI-compatible `/chat/completions` streaming | Add structured generation and renderer-job adapters beside the existing chat adapter |
| Types | `src/types.ts` contains chat messages and API settings | Add versioned visualization, scene, render-job, review, and artifact schemas |
| Persistence | `src/storage/index.ts` uses AsyncStorage for settings/history and Keychain for the API key | Add resumable job metadata and artifact indexes without storing videos in ordinary state |
| Tests | `__tests__/api.test.ts` verifies the streaming POST contract | Add schema, policy, generator, renderer, and job-state tests |
| CI | `.github/workflows/mobigpt-api.yml` runs JavaScript checks, Android release builds, and emulator smoke tests | Add a separate deterministic/live generation workflow and improve existing failure reporting |

The current package is React Native `0.82.1` with React `19.1.1`, Yarn Classic `1.22.22`, TypeScript, Jest, ESLint, AsyncStorage, Keychain, and React Native SSE. The package declares Node `>=22.21.0`.

## Attached archive comparison

The attached `src.zip` is not a complete PocketPal source tree. It contains a single `src/` directory with approximately 729 TypeScript/TSX files and no top-level `package.json`, README, lockfile, or TypeScript configuration. Its structure is an agent/CLI codebase with reusable concepts including agent and coordinator tools, task orchestration, skills, prompts, tool allowlists, sandbox/security validation, progress components, diagnostics, and commit/PR commands.

The archive will therefore be used as **design inspiration only**, not copied wholesale into the mobile application. Useful patterns identified during the audit are:

- Explicit tool allowlists and denylists in `src/tools/AgentTool/prompt.ts`.
- Bounded agent/task orchestration and progress reporting through task and coordinator modules.
- Modular prompt assets rather than one monolithic system prompt.
- Git safety rules and focused commit/PR workflows in `src/commands/commit-push-pr.ts`.
- Security-oriented command/path validation modules that inform the Manim renderer sandbox design.

The archive does not appear to be a drop-in dependency for this React Native project and has not been executed.

## Local baseline results

The first dependency installation attempt failed before package installation because the sandbox has Node `v22.13.0`, while the repository requires Node `>=22.21.0`. This is an environment mismatch, not yet a project defect.

Using Yarn’s engine override only to distinguish the runtime mismatch from project failures, the existing checks passed:

| Check | Result |
|---|---|
| `yarn --ignore-engines typecheck` | Passed |
| `yarn --ignore-engines lint` | Passed; emitted only an informational stale `baseline-browser-mapping` warning |
| `yarn --ignore-engines test --runInBand` | Passed; 1 suite and 1 test |
| Android/iOS build | Not run in the sandbox baseline; requires the platform toolchains and will remain CI/device validation work |

The Node version requirement will be made consistent across local documentation and CI diagnostics. The implementation should not weaken the package engine declaration merely to accommodate an older local runtime.

## Upstream GitHub Actions findings

The current workflow is named `MobiGPT API Chat`. It triggers pushes only to `openai-only-clean` plus manual dispatch, which means the new `manim-agent` branch will not receive push validation until the trigger is expanded. Its JavaScript checks run before Android builds, and its release/emulator jobs use a required optimized release gate.

The pinned commit’s upstream run succeeded: [run 32282166031](https://github.com/BinaryRahul/pocketpal-ai/actions/runs/32282166031). Several later runs failed. The representative failure [run 32290508457](https://github.com/BinaryRahul/pocketpal-ai/actions/runs/32290508457) passed typecheck/lint/test and the release APK/AAB builds, but failed in both ARM64 emulator validation jobs during `Set up Android SDK on ARM64 runner`.

The first causal error in the failing ARM64 jobs was:

> `Warning: Failed to find package 'emulator'`
>
> `Error: The process '/home/runner/.android/sdk/cmdline-tools/20.0/bin/sdkmanager' failed with exit code 1`

The downstream required release gate then failed because the ARM64 smoke jobs failed. This is an emulator/SDK provisioning issue, not a JavaScript or Android application compilation issue. The workflow improvement should make that distinction visible, avoid treating cascaded gate failures as independent root causes, and either provision the emulator package explicitly on ARM64 or separate/condition the ARM64 validation job according to runner support.

## Immediate implementation implications

The first feature commits should preserve the existing chat behavior and add the Manim subsystem behind new typed boundaries. The first CI changes should:

1. Trigger validation on `manim-agent` and pull requests while retaining manual dispatch.
2. Keep deterministic offline generation tests as the merge-safe gate.
3. Add a separately labeled live-provider smoke test using a GitHub Actions secret only when enabled.
4. Sanitize and upload diagnostics without credentials or sensitive prompts.
5. Report the first causal job/step and distinguish infrastructure failures from code failures.
6. Add the required Manim/FFmpeg environment independently from Android emulator jobs.

## References

- [Requested pinned tree](https://github.com/BinaryRahul/pocketpal-ai/tree/9f1488d07caf84318072f99c521360072a736f9c)
- [User fork](https://github.com/Cloaky899/pocketpal-ai)
- [Pinned upstream workflow run](https://github.com/BinaryRahul/pocketpal-ai/actions/runs/32282166031)
- [Representative failed workflow run](https://github.com/BinaryRahul/pocketpal-ai/actions/runs/32290508457)
- [Manim Community Edition](https://github.com/ManimCommunity/manim)
- [Regolo.ai API documentation](https://docs.regolo.ai/getting-started/quick-start/)
