import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { initialState } from '../src/domain.js';
import { createBlobStore } from '../server/blob-store.js';
import { handlePortfolio } from '../server/portfolio-api.js';
import { createHandler, protectedDeploymentHost } from '../api/portfolio.js';

function setup() {
  let snapshot = { revision: 7, state: initialState({}, '2026-01-01'), updatedAt: '2026-01-01T00:00:00Z' }, etag = 'one', writes = 0;
  const client = {
    async head() { return { etag }; },
    async get(path, options) { assert.equal(options.access, 'private'); assert.equal(options.useCache, false); return { statusCode: 200, blob: { etag }, stream: new Response(JSON.stringify(snapshot)).body }; },
    async put(path, body, options) {
      assert.equal(options.access, 'private'); assert.ok(options.ifMatch); assert.equal(options.addRandomSuffix, false);
      if (options.ifMatch !== etag) throw new BlobPreconditionFailedError();
      snapshot = JSON.parse(body); etag = String(++writes); return { etag };
    },
  };
  return { store: createBlobStore('test-token', client), snapshot: () => structuredClone(snapshot), writes: () => writes };
}
test('shared private storage atomically rejects concurrent and stale writes', async () => {
  const ctx = setup(), first = ctx.snapshot().state, second = structuredClone(first);
  first.settings.annualGoal = 1200000; second.settings.annualGoal = 900000;
  const results = await Promise.all([ctx.store.save(7, first), ctx.store.save(7, second)]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal(ctx.writes(), 1);
  assert.equal(ctx.snapshot().revision, 8);
  assert.equal(await ctx.store.save(7, second), null); assert.equal(ctx.writes(), 1);
});
test('private storage uses a strong metadata ETag when a CDN weakens the download ETag', async () => {
  const snapshot = { revision: 2, state: initialState({}, '2026-01-01') };
  let written = false;
  const client = {
    async head() { return { etag: '"strong-storage-etag"' }; },
    async get() { return { statusCode: 200, blob: { etag: 'W/"strong-storage-etag"' }, stream: new Response(JSON.stringify(snapshot)).body }; },
    async put(path, body, options) { assert.equal(options.ifMatch, '"strong-storage-etag"'); written = true; },
  };
  assert.equal((await createBlobStore('test-token', client).save(2, snapshot.state)).revision, 3);
  assert.ok(written);
});
test('private API preserves validation, month data, write locks and cross-origin protection', async () => {
  const ctx = setup(), opts = { store: ctx.store, authProvider: 'vercel' };
  const initial = await (await handlePortfolio(new Request('https://protected.vercel.app/api/portfolio'), opts)).json();
  assert.equal(initial.revision, 7); assert.equal(initial.authProvider, 'vercel'); assert.equal(initial.etag, undefined);
  const request = (body, origin = 'https://protected.vercel.app') => new Request('https://protected.vercel.app/api/portfolio', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await handlePortfolio(request(initial, 'https://other.example'), opts)).status, 403);
  assert.equal((await handlePortfolio(request(initial), { ...opts, writeLocked: true })).status, 503);
  assert.equal((await handlePortfolio(request({ revision: -1, state: initial.state }), opts)).status, 400);
  assert.equal((await handlePortfolio(request({ revision: 7, state: {} }), opts)).status, 400);
  assert.equal(ctx.writes(), 0);
  initial.state.utilities.items.push({ id: 'bill', propertyId: 'p231', label: 'Услуга', due: 'до 15', average: 0, frequency: 'monthly', active: true, note: '' });
  initial.state.utilities.marks['2026-11'] = { bill: 'green' };
  assert.equal((await handlePortfolio(request(initial), opts)).status, 200);
  assert.equal((await handlePortfolio(request(initial), opts)).status, 409);
  const saved = await (await handlePortfolio(new Request('https://protected.vercel.app/api/portfolio'), opts)).json();
  assert.deepEqual(saved.state, initial.state); assert.equal(saved.revision, 8);
});
test('Vercel adapter refuses unprotected aliases before touching private storage', async () => {
  const env = { VERCEL: '1', VERCEL_URL: 'moi-kvartiry-generated.vercel.app', BLOB_READ_WRITE_TOKEN: 'test-token' };
  assert.equal(protectedDeploymentHost({ host: env.VERCEL_URL }, env), true);
  assert.equal(protectedDeploymentHost({ host: 'moi-kvartiry.vercel.app' }, env), false);
  assert.equal(protectedDeploymentHost({ host: env.VERCEL_URL }, {}), false);
  let calls = 0;
  const handler = createHandler(env, async () => { calls++; return Response.json({ ok: true }); });
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } });
  const denied = response(); await handler({ headers: { host: 'public.example' }, method: 'GET', url: '/api/portfolio' }, denied);
  assert.equal(denied.statusCode, 403); assert.equal(calls, 0);
  const allowed = response(); await handler({ headers: { host: env.VERCEL_URL }, method: 'GET', url: '/api/portfolio' }, allowed);
  assert.equal(allowed.statusCode, 200); assert.equal(calls, 1);
});
