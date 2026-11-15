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
  const r = await worker.fetch(new Request('https://test/'), env); assert.equal(r.status, 200); assert.ok((await r.text()).includes('lang="ru"')); assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await worker.fetch(new Request('https://test/assets/app.js'), env)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await worker.fetch(new Request('https://test/favicon.svg'), env)).status, 200);
});
