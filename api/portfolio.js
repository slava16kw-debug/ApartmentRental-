import { handlePortfolio } from '../server/portfolio-api.js';

// Standard Vercel Protection covers this generated deployment hostname. Never
// serve personal data through an unprotected custom domain or arbitrary alias.
export function protectedDeploymentHost(headers, env) {
  const expected = env.VERCEL_URL;
  const host = headers.host;
  return env.VERCEL === '1' && typeof expected === 'string' && /^[a-z0-9-]+\.vercel\.app$/.test(expected) && typeof host === 'string' && host.toLowerCase() === expected.toLowerCase();
}
export function createHandler(env = process.env, portfolio = handlePortfolio) {
  return async function handler(req, res) {
    if (!protectedDeploymentHost(req.headers, env)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.end(JSON.stringify({ error: 'Откройте защищённую ссылку приложения на Vercel.' }));
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.body !== undefined) body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
      else {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 3000000) { res.statusCode = 413; return res.end('Request too large'); }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
    }
    const request = new Request(`https://${env.VERCEL_URL}${req.url || '/api/portfolio'}`, { method: req.method, headers, body });
    const response = await portfolio(request, { token: env.BLOB_READ_WRITE_TOKEN, authProvider: 'vercel' });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) res.setHeader(key, value);
    return res.end(Buffer.from(await response.arrayBuffer()));
  };
}
export default createHandler();
