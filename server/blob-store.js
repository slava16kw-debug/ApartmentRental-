import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { validateState } from '../src/domain.js';

export const PORTFOLIO_PATH = 'rental/portfolio.json';
export function createBlobStore(token, client = { get, put }) {
  if (!token) throw Error('Private storage is not configured');
  return {
    async read() {
      const result = await client.get(PORTFOLIO_PATH, { access: 'private', token, useCache: false });
      if (!result || result.statusCode !== 200) throw Error('Private portfolio has not been initialized');
      const snapshot = await new Response(result.stream).json();
      if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0 || !result.blob.etag) throw Error('Invalid private portfolio snapshot');
      validateState(snapshot.state);
      return { snapshot, etag: result.blob.etag };
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
