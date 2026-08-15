const assert = require('node:assert/strict');
const test = require('node:test');

const { createServer } = require('../server');

async function startServer() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

test('トップページとJavaScriptを配信する', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const pageResponse = await fetch(url);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html/);
  assert.match(await pageResponse.text(), /AutoShiftMaker/);

  const scriptResponse = await fetch(`${url}/app.js`);
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get('content-type'), /^text\/javascript/);

  const testPatternResponse = await fetch(`${url}/test-pattern.js`);
  assert.equal(testPatternResponse.status, 200);

  const exporterResponse = await fetch(`${url}/exporter.js`);
  assert.equal(exporterResponse.status, 200);

  const workerResponse = await fetch(`${url}/solver-worker.js`);
  assert.equal(workerResponse.status, 200);

  const milpResponse = await fetch(`${url}/milp-scheduler.js`);
  assert.equal(milpResponse.status, 200);

  const wasmResponse = await fetch(`${url}/vendor/highs/highs.wasm`);
  assert.equal(wasmResponse.status, 200);
  assert.equal(wasmResponse.headers.get('content-type'), 'application/wasm');
});

test('公開対象外のファイルは配信しない', async (t) => {
  const { server, url } = await startServer();
  t.after(() => server.close());

  const response = await fetch(`${url}/package.json`);
  assert.equal(response.status, 404);
});
