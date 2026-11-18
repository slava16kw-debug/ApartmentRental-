import { get, head, put, BlobPreconditionFailedError } from '@vercel/blob';
import { validateState } from '../src/domain.js';

export const PORTFOLIO_PATH = 'rental/portfolio.json';
export function createBlobStore(token, client = { get, head, put }) {
  if (!token) throw Error('Private storage is not configured');
  return {
    async read() {
      // CDN compression can weaken the download ETag. Obtain the strong
      // storage ETag from metadata and ensure the object stayed stable while read.
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await client.head(PORTFOLIO_PATH, { token });
        const result = await client.get(PORTFOLIO_PATH, { access: 'private', token, useCache: false, headers: { 'Accept-Encoding': 'identity' } });
        if (!result || result.statusCode !== 200) throw Error('Private portfolio has not been initialized');
        const snapshot = await new Response(result.stream).json();
        const after = await client.head(PORTFOLIO_PATH, { token });
        if (before.etag !== after.etag) continue;
        if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0 || !after.etag) throw Error('Invalid private portfolio snapshot');
        validateState(snapshot.state);
        return { snapshot, etag: after.etag };
      }
      throw Error('Private portfolio changed during read');
    },
    async save(revision, state) {
      validateState(state);
      const current = await this.read();
      if (current.snapshot.revision !== revision) return null;
      const snapshot = { revision: revision + 1, state, updatedAt: new Date().toISOString() };
      try {
        await client.put(PORTFOLIO_PATH, JSON.stringify(snapshot), { access: 'private', token, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: current.etag, cacheControlMaxAge: 60 });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError') return null;
        throw error;
      }
      return { revision: snapshot.revision, updatedAt: snapshot.updatedAt };
    },
  };
}
