import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import worker from '../dist/server/index.js';
import { today, monthOf, addMonths, finances } from '../src/domain.js';

test('zero rent survives create, edit, vacancy ranges and reload through the form and API', async t => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_milky_vulcan.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const env = { PRIVATE_SITE: 'true', DB: { prepare(sql) { return { values: [], bind(...v) { this.values = v; return this; }, async first() { return sqlite.prepare(sql).get(...this.values); }, async run() { return sqlite.prepare(sql).run(...this.values); } }; } } };
  const request = (path, init = {}) => worker.fetch(new Request(new URL(path, 'https://test/'), { ...init, headers: { ...init.headers, Origin: 'https://test' } }), env);
  const getState = async () => (await request('/api/portfolio')).json();
  const initial = await getState();
  initial.state.contracts = initial.state.contracts.filter(c => c.propertyId !== 'p741');
  assert.equal((await request('/api/portfolio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initial) })).status, 200);
  const html = await (await request('/')).text(), script = await (await request('/assets/app.js')).text();
  const boot = async () => {
    const dom = new JSDOM(html.replace('<script type="module" src="/assets/app.js"></script>', ''), { url: 'https://test/', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window; w.structuredClone = structuredClone; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.fetch = request;
    const waitFor = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('UI did not finish: ' + w.document.body.textContent.slice(-700)); };
    w.eval(script); await waitFor(() => w.document.querySelector('h1'));
    const q = selector => { const el = w.document.querySelector(selector); assert.ok(el, selector); return el; };
    const set = (name, value) => { const el = q(`[name="${name}"]`); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    const submit = async (valid = true) => {
      if (valid) assert.ok(q('#active-form').checkValidity(), 'Browser validation should accept the record');
      q('#active-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => !w.document.querySelector('#active-form') || q('#form-error').textContent);
      if (valid) assert.equal(w.document.querySelector('#form-error')?.textContent || '', '');
    };
    return { dom, q, set, submit };
  };
  let { dom, q, set, submit } = await boot();
  const per = monthOf(today()), previous = addMonths(per, -1);
  q('[data-action="payment"]').click(); set('amount', '50000'); await submit();
  let saved = await getState(); const originalId = saved.state.payments[0].id;
  q(`[data-action="edit-payment"][data-id="${originalId}"]`).click();
  set('amount', '0'); assert.equal(q('[name="amount"]').min, '0'); await submit();
  saved = await getState();
  assert.equal(saved.state.payments.length, 1);
  assert.equal(saved.state.payments[0].id, originalId);
  assert.equal(saved.state.payments[0].amount, 0);
  assert.equal(saved.state.payments[0].method, '');
  q(`[data-action="edit-payment"][data-id="${originalId}"]`).click();
  assert.equal(q('[name="amount"]').value, '0', 'Reopening must not substitute the contractual rent');
  for (const invalid of ['', '-1']) {
    set('amount', invalid); assert.equal(q('#active-form').checkValidity(), false);
    await submit(false); assert.ok(q('#form-error').textContent);
    assert.equal((await getState()).revision, saved.revision, 'Invalid edits must not delete the saved zero');
  }
  set('amount', '0'); set('kind', 'reimbursement');
  assert.equal(q('[name="amount"]').min, '0.01'); await submit(false);
  assert.equal((await getState()).revision, saved.revision);
  q('[data-action="close"]').click();
  q('[data-action="payment"]').click(); set('propertyId', 'p741'); set('period', previous); set('endPeriod', per); set('amount', '0');
  assert.equal(q('[name="contractId"]').value, ''); assert.equal(q('[name="contractId"]').required, false);
  await submit(); saved = await getState();
  assert.deepEqual(saved.state.payments.filter(p => p.propertyId === 'p741').map(p => [p.period, p.amount, p.contractId]), [[previous, 0, ''], [per, 0, '']]);
  assert.equal(saved.state.contracts.length, 1, 'Vacancy records must not invent a tenant');
  assert.equal(finances(saved.state, { year: today().slice(0, 4) }).profit, 0);
  // A fresh page must load the saved zeros and still allow normal rent afterwards.
  dom.window.close(); ({ dom, q, set, submit } = await boot());
  const cell = `.sheet-rent[data-property="p741"][data-period="${per}"]`;
  assert.equal(q(cell).textContent, '0'); assert.ok(q(cell).classList.contains('sheet-rent-zero'));
  q(cell + ' button').click(); assert.equal(q('[name="amount"]').value, '0'); assert.equal(q('[name="contractId"]').value, '');
  await submit();
  q(`[data-action="edit-payment"][data-id="${originalId}"]`).click(); set('amount', '50000'); await submit();
  saved = await getState();
  assert.equal(saved.state.payments.length, 3); assert.equal(saved.state.payments.find(p => p.id === originalId).amount, 50000);
  assert.equal(finances(saved.state, { year: today().slice(0, 4) }).rent, 50000);
  // A future lease is editable before move-in, including its exceptional first due date.
  const nextMonth = addMonths(per), firstDueDate = nextMonth + '-16';
  q('[data-view="properties"]').click(); q('[data-action="contract:p741"]').click();
  set('tenant', 'Будущий арендатор'); set('start', nextMonth + '-01'); set('firstDueDate', firstDueDate);
  set('dueDay', '21'); await submit();
  const future = (await getState()).state.contracts.find(c => c.propertyId === 'p741');
  assert.equal(future.firstDueDate, firstDueDate);
  q('[data-action="contract:p741"]').click();
  assert.equal(q('[name="tenant"]').value, 'Будущий арендатор');
  assert.equal(q('[name="firstDueDate"]').value, firstDueDate);
  await submit();
  const contracts = (await getState()).state.contracts.filter(c => c.propertyId === 'p741');
  assert.equal(contracts.length, 1); assert.equal(contracts[0].id, future.id); assert.equal(contracts[0].firstDueDate, firstDueDate);
});
