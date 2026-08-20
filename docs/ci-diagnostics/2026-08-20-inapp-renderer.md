# In-App Renderer Device and CI Validation

## Validation scope

The in-app renderer feature was validated at three layers: TypeScript and unit contracts, real Chromium execution of the generated WebView asset, and the native Android release gates triggered from the pushed `manim-agent` branch.

| Layer                               | Result | Evidence                                                                                             |
| ----------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| DSL, bridge, and pipeline contracts | Passed | 5 Jest suites, 13 tests; TypeScript and ESLint passed                                                |
| Generated WebView asset             | Passed | Chromium smoke reported `hasReady: true`, `hasCanvas: true`, and `compileOk: true`                   |
| In-app renderer workflow            | Passed | [GitHub Actions run 32351712691](https://github.com/Cloaky899/pocketpal-ai/actions/runs/32351712691) |
| Android native integration          | Passed | [GitHub Actions run 32351712699](https://github.com/Cloaky899/pocketpal-ai/actions/runs/32351712699) |
| Existing Manim generation workflow  | Passed | [GitHub Actions run 32351712690](https://github.com/Cloaky899/pocketpal-ai/actions/runs/32351712690) |

The Android workflow passed typecheck, lint, tests, the optimized ARM64 release APK, the optimized x86_64 release APK, and the optimized release AAB. Optional emulator smoke tests remained skipped because the workflow intentionally gates them behind explicit opt-in dispatch.

## Local build diagnosis

A local `./gradlew :app:assembleDebug --no-daemon --stacktrace` attempt could not reach compilation because the sandbox does not contain an Android SDK, `adb`, `sdkmanager`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `android/local.properties`. This is an environment limitation, not a source or dependency failure. The same native dependency set compiled successfully on the GitHub Actions Android runner for the current branch commit.

The local, device-independent acceptance command is:

```text
yarn --ignore-engines typecheck
yarn --ignore-engines lint
yarn --ignore-engines test --runInBand
yarn --ignore-engines build:inapp-renderer
yarn --ignore-engines test:inapp-renderer
```

The real Chromium smoke test executes the exact generated HTML asset that the React Native WebView imports. It sends a JSON-only `loadProgram` command through the same bridge protocol, verifies the `ready` event, checks that a WebGL canvas exists, and requires an affirmative `compileResult` event. The test does not execute model-generated code.

## Root-cause repair performed

The first local Chromium smoke attempt failed before bootstrap because the asset generator emitted `<\\/script>` as the literal HTML closing sequence. Chromium therefore treated the remainder of the document as script text. The generator was corrected to emit real `</script>` delimiters while escaping only any matching sequence inside embedded source content. The rerun passed locally and in GitHub Actions.

## Security observations

The WebView asset is bundled locally, uses a restrictive content security policy with `connect-src 'none'`, restricts navigation to the synthetic local origin, disables file and universal file access, and receives only validated JSON DSL bundles. The renderer bridge rejects unsupported protocol versions, unknown event types, non-monotonic sequence numbers, and malformed messages. The model is never allowed to send JavaScript, Python, imports, URLs, or executable source to the WebView.
