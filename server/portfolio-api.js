import { validateState } from '../src/domain.js';
import { createBlobStore } from './blob-store.js';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
export async function handlePortfolio(request, { token, writeLocked = false, authProvider = 'chatgpt', store = token ? createBlobStore(token) : null }) {
  if (!store) return json({ error: 'Приватное хранилище ещё не подключено.' }, 503);
  try {
    if (request.method === 'GET') {
      const { snapshot } = await store.read();
      return json({ ...snapshot, authProvider });
    }
    if (request.method !== 'PUT') return json({ error: 'Метод не поддерживается.' }, 405);
    if (writeLocked) return json({ error: 'Обновляем хранилище. Сохраните запись ещё раз через минуту.' }, 503);
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Сохранение разрешено только из приложения.' }, 403);
    if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Ожидается JSON.' }, 415);
    if (Number(request.headers.get('content-length') || 0) > 3000000) return json({ error: 'Резервная копия слишком большая.' }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 3000000) return json({ error: 'Слишком много данных.' }, 413);
    const body = JSON.parse(raw);
    if (!Number.isInteger(body.revision) || body.revision < 0) return json({ error: 'Обновите страницу перед сохранением.' }, 400);
    try { validateState(body.state); } catch (error) { return json({ error: error.message || 'Проверьте введённые данные.' }, 400); }
    const saved = await store.save(body.revision, body.state);
    return saved ? json(saved) : json({ error: 'Данные изменились на другом устройстве. Обновите страницу и повторите действие.' }, 409);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Не удалось прочитать запись. Проверьте формат данных.' }, 400);
    // Provider errors may contain request credentials or internal storage URLs.
    return json({ error: 'Не удалось прочитать или сохранить данные. Повторите попытку.' }, 503);
  }
}
