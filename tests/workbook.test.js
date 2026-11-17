import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initialState } from '../src/domain.js';
import { renderWorkbook } from '../src/workbook.js';

test('annual workbook distinguishes readings, calculated usage, received rent, known zero and future plan', () => {
  const s = initialState({}, '2026-01-01');
  s.readings.push({ id: 'jan', meterId: 'p231-water', date: '2026-01-01', value: 100 }, { id: 'feb', meterId: 'p231-water', date: '2026-02-01', value: 112 });
  s.payments.push({ id: 'rent', propertyId: 'p231', contractId: 'c-p231', kind: 'rent', period: '2026-01', date: '2026-01-01', amount: 50000 });
  s.payments.push({ id: 'zero', propertyId: 'p231', contractId: 'c-p231', kind: 'rent', period: '2026-02', date: '2026-02-01', amount: 0 });
  s.importHistory = [{ zeroReceipts: [{ propertyId: 'p741', period: '2026-09', amount: 0 }] }];
  const before = JSON.stringify(s);
  const dom = new JSDOM(renderWorkbook(s, { year: '2026', month: 'all', propertyId: 'all' }));
  const d = dom.window.document;
  const table = d.querySelector('.sheet-readings-table');
  assert.equal(table.querySelectorAll('tbody tr').length, 12);
  assert.equal(table.querySelectorAll('thead .sheet-property-head').length, 3);
  assert.equal(table.querySelector('[data-property="p231"][data-resource="water"][data-period="2026-01"] button').textContent.trim(), '100');
  assert.equal(table.querySelector('[data-property="p231"][data-resource="water"][data-period="2026-01"] button').dataset.action, 'edit-reading');
  const empty = table.querySelector('[data-property="p231"][data-resource="gas"][data-period="2026-02"] button');
  assert.equal(empty.dataset.action, 'readings'); assert.equal(empty.dataset.date, '2026-02-01');
  const rent = table.querySelector('.sheet-rent[data-property="p231"][data-period="2026-01"] button');
  assert.equal(rent.textContent.replace(/\D/g, ''), '50000'); assert.equal(rent.dataset.action, 'edit-payment');
  const zero = table.querySelector('.sheet-rent[data-property="p231"][data-period="2026-02"]');
  assert.ok(zero.classList.contains('sheet-rent-zero'));
  assert.equal(zero.textContent, '0');
  assert.equal(zero.querySelector('button').dataset.action, 'edit-payment');
  assert.equal(zero.querySelector('button').dataset.id, 'zero');
  assert.match(zero.querySelector('button').title, /поступления не было/);
  assert.equal(table.querySelector('.sheet-rent[data-property="p741"][data-period="2026-09"] button').textContent, '0');
  const plan = table.querySelector('.sheet-rent[data-property="p231"][data-period="2026-12"]');
  assert.ok(plan.classList.contains('sheet-rent-pending')); assert.ok(/план|ожидается/.test(plan.textContent));
  const usage = d.querySelector('.sheet-usage-table tbody tr[data-period="2026-01"] [data-property="p231"][data-resource="water"]');
  assert.equal(usage.textContent, '12');
  assert.equal(d.querySelector('.sheet-usage-table tbody tr[data-period="2026-02"] [data-property="p231"][data-resource="water"]').textContent, '—');
  assert.equal(JSON.stringify(s), before, 'Rendering must not mutate saved records');
  dom.window.close();
});

test('year and property controls scope the visible workbook without changing the stored portfolio', () => {
  const s = initialState({}, '2026-11-15');
  s.readings.push({ id: 'old', meterId: 'p741-gas', date: '2025-01-01', value: 4101 }, { id: 'current', meterId: 'p741-gas', date: '2026-01-01', value: 5258 });
  const before = JSON.stringify(s);
  const dom = new JSDOM(renderWorkbook(s, { year: '2025', month: 'all', propertyId: 'p741' }));
  const d = dom.window.document;
  assert.equal(d.querySelectorAll('.sheet-readings-table .sheet-property-head').length, 1);
  assert.equal(d.querySelector('.sheet-readings-table [data-resource="gas"][data-period="2025-01"] button').textContent.replace(/\D/g, ''), '4101');
  assert.ok(d.querySelector('[data-action="sheet-year:2025"]').classList.contains('active'));
  assert.ok(d.querySelector('[data-action="sheet-year:2026"]'));
  assert.equal(JSON.stringify(s), before);
  dom.window.close();
});

test('closed-year reconciliation is a separate undated footer row and is not allocated to a property', () => {
  const s = initialState({}, '2024-01-01');
  s.payments.push({id:'rent',propertyId:'p231',contractId:'c-p231',kind:'rent',period:'2024-01',date:'2024-01-06',amount:10000});
  s.settings.annualRentTotals = {'2024':{amount:9000}};
  const before = JSON.stringify(s), dom = new JSDOM(renderWorkbook(s,{year:'2024',month:'all',propertyId:'all'}));
  const d = dom.window.document, row=d.querySelector('.sheet-reconciliation-row');
  assert.ok(row); assert.match(row.textContent,/не распределена/);
  assert.ok(row.nextElementSibling.classList.contains('sheet-year-total'));
  assert.equal(Number(row.children[1].textContent.replace(/\s/g,'')),-1000);
  const total=d.querySelector('.sheet-year-total');
  assert.equal(Number(total.children[total.children.length-3].textContent.replace(/\s/g,'')),9000);
  assert.equal(d.querySelector('.sheet-rent-received button').textContent.replace(/\s/g,''),'10000');
  assert.equal(d.querySelectorAll('.sheet-readings-table tbody tr').length,12);
  assert.equal(JSON.stringify(s),before); dom.window.close();
  const property = new JSDOM(renderWorkbook(s,{year:'2024',month:'all',propertyId:'p231'}));
  assert.equal(property.window.document.querySelector('.sheet-reconciliation-row'),null); property.window.close();
});

test('potential row sits between actual totals and meter verification with aligned yearly amounts', () => {
  const s = initialState({}, '2026-01-01');
  s.payments.push({ id: 'rent', propertyId: 'p231', contractId: 'c-p231', kind: 'rent', period: '2026-01', date: '2026-01-06', amount: 50000 });
  s.payments.push({ id: 'refund', propertyId: 'p231', kind: 'reimbursement', date: '2026-01-10', amount: 2000 });
  s.expenses.push({ id: 'rent-cost', propertyId: 'p231', amount: 17000, date: '2026-01-05', paid: true, payer: 'owner' }, { id: 'home-cost', propertyId: 'p17', amount: 7000, date: '2026-01-05', paid: true, payer: 'owner' }, { id: 'future-cost', propertyId: 'p741', amount: 9000, date: '2026-12-31', paid: true, payer: 'owner' });
  const before = JSON.stringify(s);
  const dom = new JSDOM(renderWorkbook(s, { year: '2026', month: 'all', propertyId: 'all' }));
  const d = dom.window.document, row = d.querySelector('.sheet-potential-total');
  const value = el => Number(el.childNodes[0].textContent.replace(/\s/g, ''));
  assert.ok(row.previousElementSibling.classList.contains('sheet-year-total'));
  assert.ok(row.nextElementSibling.classList.contains('sheet-verification-row'));
  assert.equal(value(row.querySelector('[data-potential-property="p231"]')), 600000);
  assert.equal(value(row.querySelector('[data-potential-property="p741"]')), 420000);
  assert.equal(value(row.querySelector('[data-potential="rent"]')), 1020000);
  assert.equal(value(row.querySelector('[data-potential="profit"]')), 1005000);
  assert.equal(row.querySelectorAll('[data-potential-property]').length, 2);
  const colspan = tr => [...tr.children].reduce((sum, cell) => sum + cell.colSpan, 0);
  assert.equal(colspan(row), colspan(row.previousElementSibling));
  assert.equal(colspan(row), colspan(row.nextElementSibling));
  assert.equal(JSON.stringify(s), before);
  dom.window.close();
  const filtered = new JSDOM(renderWorkbook(s, { year: '2026', month: '01', propertyId: 'p741' }));
  assert.equal(value(filtered.window.document.querySelector('[data-potential="rent"]')), 420000);
  filtered.window.close();
  s.contracts = s.contracts.filter(c => c.propertyId !== 'p741');
  const unknown = new JSDOM(renderWorkbook(s, { year: '2026', month: 'all', propertyId: 'all' }));
  assert.equal(unknown.window.document.querySelector('[data-potential="rent"]').textContent, '—');
  assert.equal(unknown.window.document.querySelector('[data-potential="profit"]').textContent, '—');
  unknown.window.close();
});

test('annual summary compares received rent with full occupancy and scopes expenses and percentages by property', () => {
  const s = initialState({}, '2025-01-01');
  s.settings.annualGoal = 9999;
  s.contracts[0].rent = 100; s.contracts[0].overrides = { '2025-01': 0 };
  s.contracts[1].rent = 50;
  s.payments.push({ id: 'rent-one', propertyId: 'p231', contractId: 'c-p231', kind: 'rent', period: '2025-01', date: '2025-01-06', amount: 900, method: 'Наличные' }, { id: 'rent-two', propertyId: 'p741', contractId: 'c-p741', kind: 'rent', period: '2025-01', date: '2025-01-21', amount: 100, method: 'Перевод' }, { id: 'refund', propertyId: 'p231', kind: 'reimbursement', date: '2025-01-10', amount: 200 }, { id: 'deposit', propertyId: 'p231', kind: 'deposit_in', date: '2025-01-10', amount: 500 });
  s.expenses.push({ id: 'owner', propertyId: 'p231', amount: 100, date: '2025-01-05', paid: true, payer: 'owner' }, { id: 'home', propertyId: 'p17', amount: 300, date: '2025-01-05', paid: true, payer: 'owner' }, { id: 'tenant', propertyId: 'p741', amount: 200, date: '2025-01-05', paid: true, payer: 'tenant' }, { id: 'unpaid', propertyId: 'p231', amount: 400, date: '2025-01-05', paid: false, payer: 'owner' });
  const before = JSON.stringify(s);
  const inspect = (propertyId, expected) => {
    const dom = new JSDOM(renderWorkbook(s, { year: '2025', month: '11', propertyId }));
    try {
      const d = dom.window.document;
      for (const [key, value] of Object.entries(expected)) {
        const displayed = d.querySelector(`[data-summary="${key}"]`).textContent.replace(/\s/g, '');
        assert.equal(displayed, value, key);
      }
      assert.equal(d.querySelector('[data-summary="rent-potential"]').textContent.replace(/[^\d—]/g, ''), d.querySelector('[data-potential="rent"]').textContent.replace(/[^\d—]/g, ''));
    } finally { dom.window.close(); }
  };
  inspect('all', { 'rent-potential': '1800₽', rent: '1000₽', expenses: '100₽', profit: '1100₽', 'rent-percent': '55,6%' });
  inspect('p231', { 'rent-potential': '1200₽', rent: '900₽', expenses: '100₽', profit: '1000₽', 'rent-percent': '75%' });
  inspect('p17', { 'rent-potential': '0₽', rent: '0₽', expenses: '0₽', profit: '0₽', 'rent-percent': '—' });
  assert.equal(JSON.stringify(s), before, 'Changing year and apartment must not save financial data');
  s.payments.find(p => p.id === 'rent-one').amount = 2000;
  inspect('p231', { 'rent-percent': '166,7%' });
  s.contracts[1].rent = 0;
  inspect('p741', { 'rent-potential': '0₽', 'rent-percent': '—' });
  s.contracts[1].historyOnly = true;
  inspect('p741', { 'rent-potential': '—', 'rent-percent': '—' });
  s.payments = [];
  inspect('p231', { 'rent-percent': '0%' });
});
