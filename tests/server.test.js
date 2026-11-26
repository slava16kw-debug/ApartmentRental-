import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../dist/server/index.js';
export function memoryEnv() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync(new URL('../drizzle/0000_milky_vulcan.sql', import.meta.url), 'utf8'));
  return { PRIVATE_SITE: 'true', DB: { prepare(sql) { return { values: [], bind(...v) { this.values = v; return this; }, async first() { return sqlite.prepare(sql).get(...this.values); }, async run() { return sqlite.prepare(sql).run(...this.values); } }; } }, sqlite };
}
test('initialise persisted workspace, save, reload, and reject stale write without data loss', async () => {
  const env = memoryEnv();
  const initial = await (await worker.fetch(new Request('https://test/api/portfolio'), env)).json();
  assert.equal(initial.revision, 0); assert.equal(initial.state.properties.length, 3);
  initial.state.properties[0].title = 'Обновлённая квартира';
  const put = () => worker.fetch(new Request('https://test/api/portfolio', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://test' }, body: JSON.stringify(initial) }), env);
  assert.equal((await put()).status, 200); assert.equal((await put()).status, 409);
  const reloaded = await (await worker.fetch(new Request('https://test/api/portfolio'), env)).json();
  assert.equal(reloaded.revision, 1); assert.equal(reloaded.state.properties[0].title, 'Обновлённая квартира');
});
test('cross-origin mutation and deployment without private boundary are refused', async () => {
  const env = memoryEnv();
  const r = await worker.fetch(new Request('https://test/api/portfolio', { method: 'PUT', headers: { Origin: 'https://another.test', 'Content-Type': 'application/json' }, body: '{}' }), env);
  assert.equal(r.status, 403);
  assert.equal((await worker.fetch(new Request('https://test/'), {})).status, 503);
});
test('serves application assets with safe content types and CSP', async () => {
  const env = memoryEnv();
  const r = await worker.fetch(new Request('https://test/'), env); assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('lang="ru"'));
  assert.ok(html.includes('rel="apple-touch-icon"'));
  assert.ok(html.includes('rel="manifest"'));
  assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await worker.fetch(new Request('https://test/assets/app.js'), env)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await worker.fetch(new Request('https://test/favicon.svg'), env)).status, 200);
  const manifestResponse = await worker.fetch(new Request('https://test/site.webmanifest'), env);
  assert.equal(manifestResponse.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, 'Rental Apart KW');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.purpose.includes('maskable')));
  const icons = [...manifest.icons, {src: '/icons/rental-house-v2-180.png', sizes: '180x180'}, {src: '/icons/rental-house-v2-32.png', sizes: '32x32'}];
  for (const icon of icons) {
    const url = new URL(icon.src, 'https://test');
    assert.equal(url.origin, 'https://test');
    const response = await worker.fetch(new Request(url), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  const ico = await worker.fetch(new Request('https://test/favicon.ico?v=2'), env);
  assert.equal(ico.headers.get('content-type'), 'image/x-icon');
  assert.deepEqual([...new Uint8Array(await ico.arrayBuffer()).slice(0, 4)], [0, 0, 1, 0]);
  const head = await worker.fetch(new Request('https://test/icons/rental-house-v2-512.png', {method: 'HEAD'}), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'image/png');
  assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(new Request('https://test/site.webmanifest'), {})).status, 503);
});
