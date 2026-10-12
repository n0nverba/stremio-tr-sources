import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Run the actual build with Node's ESM loader, outside Vitest's module transform.
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, ['dist/index.js'], {
  windowsHide: true,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let exited = false;
const stopped = new Promise((resolve) => child.once('close', resolve));
child.stdout.on('data', (chunk) => {
  output = (output + chunk).slice(-8192);
});
child.stderr.on('data', (chunk) => {
  output = (output + chunk).slice(-8192);
});
child.on('exit', () => {
  exited = true;
});
child.on('error', () => {
  exited = true;
});
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited)
      throw new Error(`Built server exited before readiness:\n${output}`);
    try {
      const response = await globalThis.fetch(`${base}/manifest.json`, {
        signal: globalThis.AbortSignal.timeout(500),
      });
      const manifest = await response.json();
      assert.equal(response.status, 200);
      assert.equal(manifest.id, 'com.stremiotr.sources');
      ready = true;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(ready, `Built server did not become ready:\n${output}`);
  for (const route of [
    '/stream/movie/invalid.json',
    '/stream/series/invalid.json',
  ]) {
    const response = await globalThis.fetch(base + route);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).streams, []);
  }
  const catalog = await globalThis.fetch(
    base + '/catalog/series/tr-provider-dizibox/skip=4700.json',
  );
  assert.equal(catalog.status, 200);
  const listed = (await catalog.json()).metas;
  assert.equal(listed.length, 50);
  assert.ok(listed.every((item) => item.id.startsWith('tr:dizibox:')));
  const search = await globalThis.fetch(
    base + '/catalog/series/tr-provider-dizibox/search=Breaking%20Bad.json',
  );
  assert.ok(
    (await search.json()).metas.some((item) => item.name === 'Breaking Bad'),
  );
  const demoCatalog = await globalThis.fetch(
    base + '/catalog/movie/tr-provider-blender-demo.json',
  );
  const demo = (await demoCatalog.json()).metas[0];
  const detail = await globalThis.fetch(
    base + '/meta/movie/' + encodeURIComponent(demo.id) + '.json',
  );
  assert.equal((await detail.json()).meta.name, 'Big Buck Bunny');
  const admin = await globalThis.fetch(`${base}/admin/`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Stremio TR Sources/);
  console.log(
    'Built Node server: manifest, catalog pagination/search, metadata, movie, series and admin HTTP checks passed.',
  );
} finally {
  if (!exited) child.kill();
  await stopped;
}
