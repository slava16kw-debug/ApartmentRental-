import html from 'app:html';
import client from 'app:client';
import css from 'app:css';
import { initialState, validateState } from '../src/domain.js';

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8' } });
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // This shared family workspace is intentionally deployed behind owner-private
    // Sites authentication. It must not be deployed to a public Worker endpoint.
    if (env.PRIVATE_SITE !== 'true') return json({ error: 'Не настроен приватный доступ приложения.' }, 503);
    if (url.pathname.startsWith('/api/')) {
      if (!env.DB) return json({ error: 'Хранилище ещё подключается. Повторите попытку через минуту.' }, 503);
      if (url.pathname === '/api/health') return json({ ok: true, storage: 'D1', version: '0.1.0' });
      if (url.pathname !== '/api/portfolio') return json({ error: 'Раздел не найден.' }, 404);
      try {
        if (request.method === 'GET') {
          let row = await env.DB.prepare('SELECT revision, data, updated_at FROM portfolio WHERE id = 1').first();
          if (!row) {
            let config = {};
            try { config = JSON.parse(env.INITIAL_CONFIG || '{}'); } catch { /* generic safe defaults */ }
            const state = validateState(initialState(config));
            await env.DB.prepare('INSERT OR IGNORE INTO portfolio (id, revision, data, updated_at) VALUES (1, 0, ?, ?)').bind(JSON.stringify(state), new Date().toISOString()).run();
            row = await env.DB.prepare('SELECT revision, data, updated_at FROM portfolio WHERE id = 1').first();
          }
          return json({ revision: row.revision, state: JSON.parse(row.data), updatedAt: row.updated_at });
        }
        if (request.method === 'PUT') {
          if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return json({ error: 'Сохранение разрешено только из приложения.' }, 403);
          if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Ожидается JSON.' }, 415);
          if (Number(request.headers.get('content-length') || 0) > 3000000) return json({ error: 'Резервная копия слишком большая.' }, 413);
          const raw = await request.text();
          if (raw.length > 3000000) return json({ error: 'Слишком много данных.' }, 413);
          const body = JSON.parse(raw);
          if (!Number.isInteger(body.revision) || body.revision < 0) return json({ error: 'Обновите страницу перед сохранением.' }, 400);
          validateState(body.state);
          const updatedAt = new Date().toISOString();
          const result = await env.DB.prepare('UPDATE portfolio SET data = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ? RETURNING revision').bind(JSON.stringify(body.state), updatedAt, body.revision).first();
          if (!result) return json({ error: 'Данные изменились на другом устройстве. Обновите страницу и повторите действие.' }, 409);
          return json({ revision: result.revision, updatedAt });
        }
        return json({ error: 'Метод не поддерживается.' }, 405);
      } catch (error) {
        if (error instanceof SyntaxError || !String(error.message).includes('D1')) return json({ error: error.message || 'Проверьте введённые данные.' }, 400);
        return json({ error: 'Не удалось сохранить данные. Ваши записи не удалены; повторите попытку.' }, 500);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const headers = { ...SECURITY };
    let content;
    if (url.pathname === '/assets/app.js') { headers['Content-Type'] = 'text/javascript; charset=utf-8'; content = client; }
    else if (url.pathname === '/assets/style.css') { headers['Content-Type'] = 'text/css; charset=utf-8'; content = css; }
    else if (url.pathname === '/favicon.svg') { headers['Content-Type'] = 'image/svg+xml'; content = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#183d35"/><path d="m9 19 11-9 11 9v12h-8v-8h-6v8H9Z" fill="none" stroke="#e3eacb" stroke-width="2"/></svg>'; }
    else if (url.pathname === '/' || !url.pathname.includes('.')) { headers['Content-Type'] = 'text/html; charset=utf-8'; content = html; }
    else return new Response('Not found', { status: 404 });
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
    return new Response(request.method === 'HEAD' ? null : content, { headers });
  },
};
