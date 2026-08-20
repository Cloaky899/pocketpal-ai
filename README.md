# MobiGPT Manim Agent

MobiGPT is a minimal React Native mobile chat client for **OpenAI-compatible APIs** extended with a mobile-first autonomous visualization workflow. A user can describe a mathematical or scientific concept, after which the agent plans scenes, generates a typed declarative visualization program, compiles it into a bundled local WebView renderer, samples frames for technical and visual review, repairs bounded failures, and optionally escalates to the isolated Manim Community Edition service for high-fidelity Python/FFmpeg export.

> In local-first mode, model output is a validated JSON DSL and no generated code is executed. High-fidelity mode sends only validated Manim Python to the separately isolated renderer service; neither path executes untrusted code in the React Native process.

## Features

The original chat surface remains available with streaming assistant responses, cancellation, configurable API base URL, bearer API key, model name, system prompt, temperature, and maximum output tokens. Settings and chat history persist locally, and the API key is stored through the platform keychain when available.

The new **Visualize** workspace accepts a natural-language prompt and displays the agent’s planning, validation, local WebView preview, frame review, repair, and finalization stages. Local preview is the default and requires no renderer URL. Visualization history stores bounded metadata, compiled-program hashes, review outcomes, and remote artifact URLs rather than video bytes in ordinary mobile state. The renderer endpoint remains configurable for private high-fidelity export, a trusted proxy, or a local-network development instance.

The autonomous loop is intentionally bounded. It uses versioned schemas, explicit state transitions, a maximum of three repair attempts, deterministic source validation, preview-before-final rendering, cancellation, timeout reporting, and sanitized failure artifacts. The generated program policy allows the Manim API plus explicitly permitted numerical and standard-library roots, requires a supported `Scene` subclass, rejects filesystem/network/system execution primitives, and limits source size and scene count.

## Architecture

The mobile layer is a typed orchestration client. It owns prompt composition, structured model calls, DSL validation, deterministic compilation, state transitions, persistence, progress display, and artifact links. The local preview surface is a bundled `react-native-webview` host for a vendored `manim-web` browser bundle; it accepts only the versioned JSON bridge protocol and never receives generated executable source.[6] [7] The renderer is a separate Python service that validates Manim source with the AST before launching the Manim CLI as a non-root subprocess. Its production boundary is a container with no network, a read-only root filesystem, dropped Linux capabilities, no-new-privileges, CPU/memory/PID limits, and a writable temporary directory only where required.[4]

```text
User prompt
    |
    v
React Native Visualize workspace
    |
    +--> structured planner --> ScenePlan
    |
    +--> program writer ------> ManimProgram
    |
    +--> DSL compiler --------> local manim-web WebView preview
    |                              |
    |                              +--> frame samples + self-review
    |                              |
    +--> bounded repair loop ----> local preview retry
    |
    +--> optional export -------> isolated Manim / FFmpeg renderer
    |
    +--> final result ----------> local frames or remote artifacts
```

The remaining application structure is intentionally small:

```text
App.tsx                              Chat shell, settings, and Chat/Visualize switch
src/components/VisualizationWorkspace.tsx
                                     Mobile prompt, progress, artifact, and history UI
src/visualization/types.ts            Versioned visualization and agent schemas
src/visualization/prompts.ts          Modular planner/writer/reviewer/repair prompts
src/visualization/agentState.ts       Bounded autonomous state machine
src/visualization/pipeline.ts         Mobile orchestration loop
src/visualization/rendererClient.ts   HTTP client for the isolated renderer
src/visualization/inAppTypes.ts       Safe local visualization DSL and compiled bundle types
src/visualization/inAppValidation.ts  DSL budgets and policy validation
src/visualization/dslCompiler.ts       Deterministic DSL compiler and content hashes
src/visualization/inAppRenderer.ts    Typed WebView controller and bridge sequencing
src/visualization/inAppPipeline.ts    Local compile, render, review, and repair loop
src/components/InAppVisualizationSurface.tsx
                                     Bundled local WebView surface
inapp-renderer/                      Vendored manim-web asset and Chromium smoke test
renderer/app/                         FastAPI renderer and subprocess boundary
renderer/tests/                       Policy tests and a deterministic Manim fixture
renderer/scripts/                     Live generation smoke and failure classifier
.github/workflows/manim-generation.yml
                                     Offline and opt-in live generation CI
.github/workflows/mobigpt-api.yml     JavaScript, Android build, and optional emulator CI
docs/architecture/                    Agent and renderer design invariants
docs/ci-diagnostics/                  Root-cause records and focused CI repairs
```

## Development

Use Node.js `22.21.0` or newer and Yarn Classic `1.22.22`. The implementation is on the user-owned [`manim-agent` branch](https://github.com/Cloaky899/pocketpal-ai/tree/manim-agent), forked from the requested PocketPal snapshot.

```bash
git clone https://github.com/Cloaky899/pocketpal-ai.git
cd pocketpal-ai
git checkout manim-agent
yarn install
yarn start
yarn android     # Android emulator/device
yarn ios         # macOS + Xcode only
```

Run the local JavaScript quality gates and deterministic renderer checks before pushing changes:

```bash
yarn typecheck
yarn lint
yarn test --runInBand
PYTHONPATH=renderer python3 -m unittest discover -s renderer/tests -p 'test_*.py' -v
yarn --ignore-engines build:inapp-renderer
yarn --ignore-engines test:inapp-renderer
```

A local Manim smoke render requires the Manim Community Edition runtime and FFmpeg. The renderer image is the supported production path:

```bash
docker build -t pocketpal-manim-renderer ./renderer
docker run --rm \
  --name pocketpal-manim-renderer \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --cpus 1.0 \
  --memory 1g \
  --pids-limit 128 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -p 127.0.0.1:8000:8000 \
  pocketpal-manim-renderer
```

Configure the mobile app’s model API base URL, API key, model, and renderer URL in Settings. For production, prefer a trusted backend proxy rather than embedding a shared provider key in a distributed mobile binary. The renderer should likewise be authenticated and placed behind signed artifact URLs, quotas, workspace expiration, and an external queue/worker pool before public deployment.

## CI and generation tests

The [`In-app visualization renderer` workflow](.github/workflows/inapp-renderer.yml) is the merge-safe local-render gate. It builds the generated WebView asset, runs typecheck, lint, Jest, verifies that the generated asset is reproducible, installs Chromium, and runs a real browser smoke test that boots the vendored engine, sends a JSON DSL program through the bridge, confirms the WebGL canvas, and requires a successful compile event.

The [`Manim Generation` workflow](.github/workflows/manim-generation.yml) remains the merge-safe high-fidelity generation gate. It uses the pinned `manimcommunity/manim:v0.19.1` image for Python policy tests, fixture rendering, FFmpeg frame extraction, and the optional live provider smoke test. JavaScript typecheck, lint, and Jest run in a separate native Node job. The live job is manual-dispatch-only and requires the `REGOLO_API_KEY` repository secret; no provider key is committed or printed.

The live smoke test uses the configured OpenAI-compatible endpoint and model input, requests JSON mode, validates required top-level keys, performs one bounded schema correction request, applies the renderer source policy, and renders a short scene. The default Regolo endpoint is configured in CI as `https://api.regolo.ai/v1`; use a repository secret rather than placing a literal API key in workflow files or source code.[5]

The legacy Android workflow was also repaired. Push validation now includes `manim-agent`, while emulator smoke tests are manual-dispatch-only and explicitly provision the Android `emulator` and `platform-tools` SDK packages. This keeps normal JavaScript/APK/AAB validation separate from optional emulator infrastructure diagnostics.

## Security boundaries

A mobile application cannot keep a provider key secret if it calls a third-party API directly. MobiGPT stores the key in the platform keychain and displays a recommendation to use a trusted proxy for production deployments. Do not ship a shared organization key inside a public mobile build. The custom base URL exists so a proxy can enforce authentication, rate limits, user identity, and provider isolation.[2]

Generated Python is untrusted input. The renderer’s AST policy is a first filter, not a complete sandbox; container isolation, no network, non-root execution, resource limits, short-lived workspaces, authenticated artifact access, and operational quotas are required defense-in-depth controls. The local WebView receives only a bounded DSL, uses a restrictive content security policy with `connect-src 'none'`, limits navigation to a synthetic local origin, and rejects unknown protocol versions or event sequences. The source archive supplied for inspiration was not executed or copied wholesale; only its bounded orchestration, modular prompts, allowlists, diagnostics, and commit-aware workflow patterns informed this implementation.

## API contract

Chat requests retain the existing OpenAI-compatible streaming shape:

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful, concise assistant."},
    {"role": "user", "content": "Hello"}
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": true
}
```

Visualization requests use versioned mobile-side schemas and are translated by the renderer client into the renderer’s `POST /render-jobs`, `GET /render-jobs/{id}`, `GET /render-jobs/{id}/artifacts`, and `POST /render-jobs/{id}/cancel` endpoints. The renderer returns status, progress, failure category, sanitized error text, and artifact metadata.

Android release builds remain CI responsibilities. The app uses the stable internal React Native registration name `PocketPal` and preserves the Android application ID `com.pocketpallite` for installation compatibility, while the visible label remains **MobiGPT**.

## License

Licensed under the [MIT License](LICENSE).

## References

[1]: https://github.com/binaryminds/react-native-sse 'React Native EventSource (Server-Sent Events)'
[2]: https://github.com/backmesh/openai-react-native 'OpenAI API React Native Client security guidance'
[3]: https://developers.openai.com/api/docs/guides/streaming-responses 'OpenAI — Streaming API responses'
[4]: https://docs.manim.community/en/stable/installation/docker.html 'Manim Community — Docker installation'
[5]: https://docs.regolo.ai/getting-started/quick-start/ 'Regolo.ai — Quick start'
[6]: https://github.com/maloyan/manim-web 'maloyan/manim-web — Mathematical animations for the web'
[7]: https://github.com/react-native-webview/react-native-webview 'react-native-webview — React Native WebView'
