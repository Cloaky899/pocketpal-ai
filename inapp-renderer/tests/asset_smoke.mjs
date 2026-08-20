import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const generatedSource = readFileSync(
  join(root, 'src/visualization/inAppRendererHtml.ts'),
  'utf8',
);
const htmlExpression = generatedSource.match(
  /export const IN_APP_RENDERER_HTML = (.*);\n$/s,
)?.[1];
if (!htmlExpression)
  throw new Error('Generated in-app renderer HTML export is missing.');
const html = JSON.parse(htmlExpression);

const program = {
  schemaVersion: 1,
  requestId: 'ci-in-app-renderer',
  engine: 'manim-web',
  aspectRatio: '16:9',
  backgroundColor: '#1c1c1c',
  scenes: [
    {
      sceneId: 'smoke',
      title: 'Renderer smoke test',
      durationSeconds: 1,
      primitives: [
        {
          kind: 'circle',
          id: 'circle',
          radius: 1,
          position: [0, 0],
          color: '#75a7ff',
        },
      ],
      animations: [{kind: 'create', targetId: 'circle', durationSeconds: 0.2}],
    },
  ],
  totalDurationSeconds: 1,
  contentHash: 'ci-smoke',
};

const testHarness = `
<script>
  window.__POCKETPAL_TEST_MESSAGES__ = [];
  window.ReactNativeWebView = {
    postMessage(message) {
      window.__POCKETPAL_TEST_MESSAGES__.push(JSON.parse(message));
    }
  };
  setTimeout(() => {
    window.postMessage({
      protocolVersion: 1,
      type: 'loadProgram',
      runId: 'ci-run',
      bundle: ${JSON.stringify(program)}
    }, '*');
  }, 500);
  setTimeout(() => {
    const messages = window.__POCKETPAL_TEST_MESSAGES__;
    const hasReady = messages.some(message => message.type === 'ready');
    const compile = messages.find(message => message.type === 'compileResult');
    const hasCanvas = document.querySelectorAll('canvas').length > 0;
    document.documentElement.setAttribute(
      'data-pocketpal-result',
      JSON.stringify({hasReady, hasCanvas, compileOk: compile?.ok === true})
    );
  }, 7000);
</script>
`;

const testHtml = html
  .replace('<head>', `<head>${testHarness}`)
  .replace('</body>', '</body>');
const temp = mkdtempSync(join(tmpdir(), 'pocketpal-inapp-renderer-'));
const htmlPath = join(temp, 'index.html');
writeFileSync(htmlPath, testHtml);

try {
  const output = execFileSync(
    '/usr/bin/chromium',
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--disable-web-security',
      '--virtual-time-budget=10000',
      '--dump-dom',
      `file://${htmlPath}`,
    ],
    {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024},
  );
  const match = output.match(/data-pocketpal-result="([^"]+)"/);
  if (!match)
    throw new Error('The browser did not publish an in-app renderer result.');
  const result = JSON.parse(match[1].replaceAll('&quot;', '"'));
  if (!result.hasReady || !result.hasCanvas || !result.compileOk) {
    throw new Error(
      `In-app renderer smoke test failed: ${JSON.stringify(result)}`,
    );
  }
  console.log(JSON.stringify(result));
} finally {
  rmSync(temp, {recursive: true, force: true});
}
