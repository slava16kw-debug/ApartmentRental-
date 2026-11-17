import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import worker from '../dist/server/index.js';
import { initialState, finances, receivedRentPayments, today, monthOf, addMonths } from '../src/domain.js';
import { renderWorkbook } from '../src/workbook.js';

test('rent methods count actual rent by receipt date, including split payments, without attributing unknown money', () => {
  const s = initialState({}, '2025-01-01');
  const receipt = (id, propertyId, amount, method, date = '2026-01-01', period = '2026-02', kind = 'rent') => ({ id, propertyId, contractId: 'c-' + propertyId, amount, method, date, period, kind });
  s.payments.push(
    receipt('cash', 'p231', 50000.25, 'Наличные'),
    receipt('split-transfer', 'p741', 20000.10, 'Перевод'),
    receipt('split-cash', 'p741', 15000.20, 'Наличные'),
    receipt('unknown', 'p231', 1000, 'Импорт Excel'),
    receipt('other', 'p741', 500, 'Другое'),
    receipt('zero', 'p741', 0, ''),
    receipt('future', 'p231', 50000, 'Наличные', '2026-12-01'),
    receipt('old', 'p231', 50000, 'Наличные', '2025-12-31'),
    receipt('late-for-previous-year', 'p741', 5000, 'Перевод', '2026-01-01', '2025-12'),
    receipt('deposit', 'p231', 50000, 'Наличные', '2026-01-01', '', 'deposit_in'),
    receipt('reimbursement', 'p231', 3000, 'Перевод', '2026-01-01', '', 'reimbursement'),
    receipt('home', 'p17', 9000, 'Наличные'),
  );
  const filter = { year: 2026, now: '2026-11-17' }, before = JSON.stringify(s);
  const f = finances(s, filter);
  assert.deepEqual(f.rentMethods, { cash: 65000.45, transfer: 25000.10, other: 500, unspecified: 1000 });
  assert.equal(f.recordedRent, 91500.55);
  assert.equal(f.profit, 94500.55);
  assert.equal(receivedRentPayments(s, filter).length, 7);
  assert.deepEqual(finances(s, { ...filter, propertyId: 'p741' }).rentMethods, { cash: 15000.20, transfer: 25000.10, other: 500, unspecified: 0 });
  assert.deepEqual(finances(s, { ...filter, month: '02' }).rentMethods, { cash: 0, transfer: 0, other: 0, unspecified: 0 });
  assert.deepEqual(finances(s, { ...filter, propertyId: 'p17' }).rentMethods, { cash: 0, transfer: 0, other: 0, unspecified: 0 });
  assert.equal(JSON.stringify(s), before);
});

test('annual method summary uses the whole year and keeps annual reconciliation separate', () => {
  const s = initialState({}, '2024-01-01');
  s.payments.push({ id: 'unknown', propertyId: 'p231', contractId: 'c-p231', kind: 'rent', date: '2024-01-01', period: '2024-01', amount: 10000, method: 'Импорт Excel' });
  s.settings.annualRentTotals = { '2024': { amount: 9000 } };
  const before = JSON.stringify(s), dom = new JSDOM(renderWorkbook(s, { year: '2024', month: '11', propertyId: 'all' }));
  const d = dom.window.document;
  const value = key => Number(d.querySelector(`[data-rent-method-summary="${key}"]`).textContent.replace(/[^\d-]/g, ''));
  assert.equal(value('cash'), 0); assert.equal(value('transfer'), 0); assert.equal(value('unspecified'), 10000);
  assert.equal(d.querySelector('.sheet-summary [data-rent-method-summary]'), null);
  const methods = d.querySelector('.sheet-rent-methods');
  assert.ok(methods.querySelector('[data-rent-method-summary="cash"]'));
  assert.ok(methods.previousElementSibling.querySelector('.sheet-expenses-table'), 'Payment methods sit directly below apartment expenses');
  assert.equal(d.querySelector('[data-summary="rent-percent"]').textContent.replace(/\s/g, ''), '0,9%');
  assert.match(d.querySelector('.sheet-method-note').textContent, /не распределена/);
  assert.match(d.querySelector('.sheet-method-note').textContent.replace(/\s/g, ''), /-1000/);
  assert.equal(JSON.stringify(s), before);
  dom.window.close();
});

test('summary editor changes only selected payment methods, persists them, and respects property scope', async t => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_milky_vulcan.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const env = { PRIVATE_SITE: 'true', DB: { prepare(sql) { return { values: [], bind(...v) { this.values = v; return this; }, async first() { return sqlite.prepare(sql).get(...this.values); }, async run() { return sqlite.prepare(sql).run(...this.values); } }; } } };
  const request = (path, init = {}) => worker.fetch(new Request(new URL(path, 'https://test/'), { ...init, headers: { ...init.headers, Origin: 'https://test' } }), env);
  const getState = async () => (await request('/api/portfolio')).json();
  const initial = await getState(), year = today().slice(0, 4), date = `${year}-01-01`;
  const s = initialState({}, `${Number(year) - 1}-01-01`);
  const receipt = (id, propertyId, amount, method, period = `${year}-01`, kind = 'rent', at = date) => ({ id, propertyId, contractId: 'c-' + propertyId, amount, method, period, kind, date: at, datePrecision: 'month', source: { fixture: true }, note: 'Keep this receipt unchanged' });
  s.payments.push(receipt('cash', 'p231', 50000, 'Наличные'), receipt('split-transfer', 'p741', 20000, 'Перевод'), receipt('split-cash', 'p741', 15000, 'Наличные'), receipt('unknown', 'p231', 2300, 'Импорт Excel', `${year}-02`), receipt('zero', 'p741', 0, ''), receipt('deposit', 'p231', 10000, 'Наличные', '', 'deposit_in'), receipt('refund', 'p231', 10000, 'Перевод', '', 'reimbursement'), receipt('old', 'p231', 50000, 'Наличные', `${Number(year) - 1}-12`, 'rent', `${Number(year) - 1}-12-31`), receipt('future', 'p231', 50000, 'Наличные', addMonths(monthOf(today()), 1), 'rent', addMonths(monthOf(today()), 1) + '-01'));
  assert.equal((await request('/api/portfolio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: initial.revision, state: s }) })).status, 200);
  const html = await (await request('/')).text(), script = await (await request('/assets/app.js')).text();
  const boot = async () => {
    const dom = new JSDOM(html.replace('<script type="module" src="/assets/app.js"></script>', ''), { url: `https://test/?year=${year}`, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window; w.structuredClone = structuredClone; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.fetch = request;
    const waitFor = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('UI did not finish: ' + w.document.body.textContent.slice(-700)); };
    w.eval(script); await waitFor(() => w.document.querySelector('[data-rent-method-summary="cash"]'));
    const q = selector => { const el = w.document.querySelector(selector); assert.ok(el, selector); return el; };
    const value = key => Number(q(`[data-rent-method-summary="${key}"]`).textContent.replace(/[^\d-]/g, ''));
    const save = async () => {
      q('#active-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => !w.document.querySelector('#active-form') || w.document.querySelector('#form-error')?.textContent);
      assert.equal(w.document.querySelector('#form-error')?.textContent || '', '');
    };
    return { w, q, value, save };
  };
  const ui = await boot(), before = await getState();
  assert.equal(ui.value('cash'), 65000); assert.equal(ui.value('transfer'), 20000); assert.equal(ui.value('unspecified'), 2300);
  ui.q('[data-rent-method-summary="cash"]').click();
  assert.equal(ui.w.document.querySelectorAll('[data-rent-method-id]').length, 4);
  ui.q('[data-rent-method-id="cash"]').value = 'Перевод';
  await ui.save();
  assert.equal(ui.value('cash'), 15000); assert.equal(ui.value('transfer'), 70000);
  const saved = await getState(), expected = structuredClone(before.state);
  expected.payments.find(p => p.id === 'cash').method = 'Перевод';
  assert.deepEqual(saved.state, expected);
  assert.equal(saved.revision, before.revision + 1);
  assert.equal(finances(saved.state, { year }).profit, finances(before.state, { year }).profit);
  const reloaded = await boot();
  assert.equal(reloaded.value('cash'), 15000); assert.equal(reloaded.value('transfer'), 70000);
  reloaded.q('[data-action="edit-payment"][data-id="unknown"]').click();
  assert.equal(reloaded.q('[name="method"]').value, '', 'Legacy import labels must not silently select a transfer');
  reloaded.q('[data-action="close"]').click();
  const propertyFilter = reloaded.q('[data-filter="propertyId"]'); propertyFilter.value = 'p741'; propertyFilter.dispatchEvent(new reloaded.w.Event('change', { bubbles: true }));
  reloaded.q('[data-rent-method-summary="transfer"]').click();
  assert.equal(reloaded.w.document.querySelectorAll('[data-rent-method-id]').length, 2);
  reloaded.q('[data-rent-method-id="split-cash"]').value = 'Перевод'; await reloaded.save();
  assert.equal(reloaded.value('cash'), 0); assert.equal(reloaded.value('transfer'), 35000);
  const scoped = await getState();
  expected.payments.find(p => p.id === 'split-cash').method = 'Перевод';
  assert.deepEqual(scoped.state, expected);
  reloaded.q('[data-rent-method-summary="cash"]').click(); await reloaded.save();
  assert.equal((await getState()).revision, scoped.revision, 'An unchanged save must not rewrite the portfolio');
});
