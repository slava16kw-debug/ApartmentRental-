import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import worker from '../dist/server/index.js';
import { initialState, validateState, charges } from '../src/domain.js';

test('contract date automatically updates the visible payment day, persisted terms and future schedule', async () => {
  let stored = initialState({}, '2026-01-01'), revision = 0;
  stored.contracts = stored.contracts.filter(c => c.propertyId !== 'p741');
  const env = { PRIVATE_SITE: 'true' };
  const asset = async path => (await worker.fetch(new Request('https://test' + path), env)).text();
  const [html, script] = await Promise.all(['/', '/assets/app.js'].map(asset));
  const dom = new JSDOM(html, { url: 'https://test', runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  w.structuredClone = structuredClone; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body); assert.equal(body.revision, revision);
      stored = validateState(body.state); revision++;
      return Response.json({ revision });
    }
    return Response.json({ revision, state: structuredClone(stored) });
  };
  const wait = async fn => {
    for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
    throw Error('UI did not settle: ' + (d.querySelector('#form-error')?.textContent || ''));
  };
  const set = (name, value) => { const field = d.querySelector(`[name="${name}"]`); field.value = value; field.dispatchEvent(new w.Event('change', { bubbles: true })); };
  try {
    w.eval(script); await wait(() => d.querySelector('h1'));
    for (const day of [16, 6]) {
      d.querySelector('[data-view="properties"]').click();
      d.querySelector('[data-action="contract:p741"]').click();
      set('start', `2026-11-${String(day).padStart(2, '0')}`);
      assert.equal(d.querySelector('[name="dueDay"]').value, String(day));
      assert.equal(d.querySelector('[name="dueDay"]').readOnly, true);
      d.querySelector('#active-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await wait(() => !d.querySelector('#active-form'));
      const saved = stored.contracts.find(c => c.propertyId === 'p741');
      assert.equal(saved.dueDay, day); assert.equal(saved.dueDayFromStart, true);
      assert.equal(charges(stored, '2026-12').find(x => x.propertyId === 'p741' && x.period === '2026-12').due, `2026-12-${String(day).padStart(2, '0')}`);
      d.querySelector('[data-view="overview"]').click();
      assert.equal(d.querySelector('.sheet-readings-table [data-property="p741"] .sheet-rent-due strong').textContent, `${day}-го числа`);
    }
    assert.equal(revision, 2); assert.equal(stored.payments.length, 0);
  } finally { dom.window.close(); }
});
