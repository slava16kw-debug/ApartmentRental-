// Run through hidden stdin. Never store or print the storage credential.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { get, put, del, BlobPreconditionFailedError } from '@vercel/blob';
import { validateState } from '../src/domain.js';
import { PORTFOLIO_PATH } from '../server/blob-store.js';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const args = JSON.parse(input), options = { access: 'private', token: args.token };
  const read = async path => {
    const result = await get(path, { ...options, useCache: false });
    if (!result || result.statusCode !== 200) throw Error('Missing private object');
    return { data: await new Response(result.stream).json(), etag: result.blob.etag };
  };
  if (args.mode === 'readiness') {
    const path = `rental/readiness-${crypto.randomUUID()}.json`;
    const first = await put(path, JSON.stringify({ version: 1 }), { ...options, addRandomSuffix: false, allowOverwrite: false });
    const initial = await read(path);
    assert.equal(initial.data.version, 1); assert.equal(initial.etag, first.etag);
    const second = await put(path, JSON.stringify({ version: 2 }), { ...options, addRandomSuffix: false, allowOverwrite: true, ifMatch: initial.etag });
    let conflict = false;
    try { await put(path, JSON.stringify({ version: 3 }), { ...options, addRandomSuffix: false, allowOverwrite: true, ifMatch: initial.etag }); }
    catch (error) { if (!(error instanceof BlobPreconditionFailedError)) throw error; conflict = true; }
    assert.ok(conflict); assert.equal((await read(path)).data.version, 2);
    await del(path, { token: args.token, ifMatch: second.etag });
    console.log(JSON.stringify({ mode: 'readiness', privateReadWrite: true, atomicConflictProtection: true, temporaryObjectRemoved: true }));
  } else if (args.mode === 'import' || args.mode === 'verify') {
    const source = JSON.parse(fs.readFileSync(args.input, 'utf8'));
    const snapshot = { revision: source.revision, state: source.state, updatedAt: source.updatedAt };
    validateState(snapshot.state); assert.ok(Number.isInteger(snapshot.revision));
    if (args.mode === 'import') await put(PORTFOLIO_PATH, JSON.stringify(snapshot), { ...options, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
    const actual = await read(PORTFOLIO_PATH);
    assert.deepEqual(actual.data, snapshot);
    if (args.output) fs.writeFileSync(args.output, JSON.stringify(actual.data), { mode: 0o600 });
    console.log(JSON.stringify({ mode: args.mode, revision: snapshot.revision, verified: true, counts: Object.fromEntries(['properties', 'readings', 'payments', 'expenses'].map(key => [key, snapshot.state[key].length])) }));
  } else throw Error('Unsupported operation');
} catch (error) {
  console.log(JSON.stringify({ ok: false, errorName: error.name, code: error.code || null }));
  process.exitCode = 1;
}
