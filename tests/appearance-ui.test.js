import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import worker from '../dist/server/index.js';
import { initialState } from '../src/domain.js';

async function page(saved, { storageBlocked = false } = {}) {
  const env = { PRIVATE_SITE: 'true' };
  const asset = async path => {
    const response = await worker.fetch(new Request('https://test' + path), env);
    assert.equal(response.status, 200);
    return response.text();
  };
  const [html, init, app] = await Promise.all(['/', '/assets/theme.js', '/assets/app.js'].map(asset));
  assert.ok(html.indexOf('/assets/theme.js') < html.indexOf('/assets/style.css'), 'Apply saved theme before styles paint');
  const dom = new JSDOM(html, { url: 'https://test', runScripts: 'outside-only' });
  const w = dom.window;
  w.structuredClone = structuredClone; w.scrollTo = () => {};
  if (saved) w.localStorage.setItem('moi-kvartiry:theme:v1', saved);
  if (storageBlocked) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('Blocked', 'SecurityError'); } });
  const requests = [];
  w.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    return Response.json({ revision: 26, state: initialState(), authProvider: 'vercel' });
  };
  w.eval(init); w.eval(app);
  for (let i = 0; i < 100 && !w.document.querySelector('h1'); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(w.document.querySelector('h1'));
  return { dom, w, requests };
}

test('all three themes persist across navigation and reload without writing financial records', async () => {
  const { dom, w, requests } = await page();
  try {
    const d = w.document;
    assert.equal(d.documentElement.dataset.theme, 'dark');
    assert.equal(d.documentElement.style.colorScheme, 'dark');
    assert.equal(d.querySelector('meta[name="theme-color"]').content, '#10141b');
    const choose = id => {
      const select = d.querySelector('[data-theme-select]');
      select.value = id; select.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert.equal(d.documentElement.dataset.theme, id);
      assert.equal(w.localStorage.getItem('moi-kvartiry:theme:v1'), id);
    };
    for (const id of ['white', 'light', 'dark']) choose(id);
    assert.equal(d.documentElement.style.colorScheme, 'dark');
    assert.equal(d.querySelector('meta[name="theme-color"]').content, '#10141b');
    d.querySelector('[data-view="settings"]').click();
    const selectors = [...d.querySelectorAll('[data-theme-select]')];
    assert.equal(selectors.length, 2);
    assert.ok(selectors.every(s => s.value === 'dark'));
    assert.ok(selectors.every(s => s.getAttribute('aria-label') === 'Цветовая тема'));
    selectors[1].value = 'white'; selectors[1].dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(selectors.every(s => s.value === 'white'), 'All visible theme controls stay in sync');
    d.querySelector('[data-view="utilities"]').click();
    assert.equal(d.querySelector('[data-theme-select]').value, 'white');
    choose('dark');
    d.querySelector('[data-view="overview"]').click();
    d.querySelector('[data-action="payment"]').click();
    const amount = d.querySelector('[name="amount"]'); amount.value = '35000';
    choose('light');
    assert.equal(d.querySelector('[name="amount"]').value, '35000', 'Theme changes retain unsaved form input');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    const reloaded = await page(w.localStorage.getItem('moi-kvartiry:theme:v1'));
    assert.equal(reloaded.w.document.documentElement.dataset.theme, 'light');
    reloaded.dom.window.close();
    const darkReload = await page('dark');
    assert.equal(darkReload.w.document.querySelector('[data-theme-select]').value, 'dark');
    darkReload.dom.window.close();
  } finally { dom.window.close(); }
});

test('invalid preferences and blocked browser storage do not prevent loading or theme changes', async () => {
  for (const options of [{ saved: 'unknown' }, { storageBlocked: true }]) {
    const { dom, w } = await page(options.saved, options);
    try {
      assert.equal(w.document.documentElement.dataset.theme, 'dark');
      const select = w.document.querySelector('[data-theme-select]');
      select.value = 'dark'; select.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert.equal(w.document.documentElement.dataset.theme, 'dark');
    } finally { dom.window.close(); }
  }
});
