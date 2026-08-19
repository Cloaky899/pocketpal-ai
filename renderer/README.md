# Isolated Manim Renderer

This service accepts validated Manim Community Edition programs and renders them in a separate worker process. It is intended to be run in the supplied container image, not embedded directly in the React Native process.

## Local build and run

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

The service exposes `GET /health`, `POST /render-jobs`, `GET /render-jobs/{id}`, `GET /render-jobs/{id}/artifacts`, `GET /render-jobs/{id}/artifacts/{name}`, and `POST /render-jobs/{id}/cancel`.

## Execution boundary

The API validates request sizes and schemas before a job is created. The worker parses the source with Python’s AST, allows only the Manim/NumPy/SciPy and explicitly safe standard-library roots needed by the generated scene, rejects system/network/file execution primitives, requires at least one supported Scene subclass, and limits the number of scenes.

The worker writes the source into a `0700` per-job workspace and launches the `manim` CLI as a non-root subprocess with a reduced environment. The container is expected to provide the stronger boundary: no network, read-only root filesystem, non-root user, dropped Linux capabilities, no-new-privileges, CPU/memory/PID limits, and a writable temporary filesystem only where required. Timeouts are enforced both at the API job level and per scene. Logs are truncated and returned as sanitized artifacts.

The service keeps job metadata in memory for the initial implementation. Production deployment should place job state and artifacts behind authenticated storage, use signed artifact URLs, enforce per-user quotas, expire workspaces, and add an external queue/worker pool rather than relying on one process.
