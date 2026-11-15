import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, finances, charges, usage, intervals, dueDate, demoState } from '../src/domain.js';
const now = '2026-11-15';
const state = () => initialState({}, now);
const payment = (id, propertyId, amount, kind = 'rent', date = '2026-11-06', period = '2026-11') => ({ id, propertyId, contractId: 'c-' + propertyId, kind, date, period, amount });
test('actual rent minus paid rental costs; residence costs and deposits stay separate', () => {
  const s = state();
  s.payments.push(payment('a', 'p231', 50000), payment('b', 'p741', 35000), payment('d', 'p231', 50000, 'deposit_in'));
  s.expenses.push({ id: 'e', propertyId: 'p231', amount: 5000, date: '2026-11-10', paid: true, payer: 'owner' }, { id: 'h', propertyId: 'p17', amount: 7000, date: '2026-11-10', paid: true, payer: 'owner' });
  validateState(s);
  const f = finances(s, { year: 2026, now });
  assert.equal(f.rent, 85000); assert.equal(f.profit, 80000); assert.equal(f.homeExpenses, 7000); assert.equal(f.remaining, 73000);
});
test('future payments, unpaid costs, and tenant-paid bills do not change actual profit', () => {
  const s = state();
  s.payments.push(payment('a', 'p231', 50000, 'rent', '2026-12-06', '2026-12'));
  s.expenses.push({ id: 'e', propertyId: 'p231', amount: 5000, date: '2026-11-10', paid: false, payer: 'owner' }, { id: 't', propertyId: 'p231', amount: 5000, date: '2026-11-10', paid: true, payer: 'tenant' });
  assert.equal(finances(s, { year: 2026, now }).profit, 0);
});
test('reimbursement offsets a bill once; actual payment dates select the year', () => {
  const s = state(); s.payments.push(payment('a', 'p231', 50000, 'rent', '2027-01-06', '2026-12'), payment('r', 'p231', 5000, 'reimbursement'));
  s.expenses.push({ id: 'e', propertyId: 'p231', amount: 5000, date: '2026-10-01', paidDate: '2026-11-01', paid: true, payer: 'owner' });
  assert.equal(finances(s, { year: 2026, now }).profit, 0);
  assert.equal(finances(s, { year: 2027, now: '2027-01-15' }).rent, 50000);
});
test('partial payment retains remaining debt and advance covers its assigned month', () => {
  const s = state(); s.payments.push(payment('a', 'p231', 20000), payment('b', 'p741', 35000, 'rent', '2026-11-10', '2026-12'));
  const cs = charges(s, '2026-12', now);
  assert.equal(cs.find(c => c.propertyId === 'p231' && c.period === '2026-11').debt, 30000);
  assert.equal(cs.find(c => c.propertyId === 'p231' && c.period === '2026-11').status, 'late');
  assert.equal(cs.find(c => c.propertyId === 'p741' && c.period === '2026-12').debt, 0);
  assert.equal(cs.find(c => c.propertyId === 'p741' && c.period === '2026-11').debt, 35000);
});
test('effective rate changes preserve historical monthly charges and tenant gaps', () => {
  const s = state(); s.settings.accountingStart = '2026-01-01';
  s.contracts[0].start = '2026-01-01'; s.contracts[0].end = '2026-11-30';
  s.contracts.push({ id: 'new', propertyId: 'p231', start: '2026-12-01', end: '', rent: 55000, dueDay: 8, tenant: 'Новый' });
  validateState(s);
  const cs = charges(s, '2026-12', now).filter(c => c.propertyId === 'p231');
  assert.equal(cs.find(c => c.period === '2026-11').amount, 50000);
  assert.equal(cs.find(c => c.period === '2026-12').amount, 55000);
  s.contracts.at(-1).start = '2027-01-01';
  assert.equal(charges(s, '2026-12', now).filter(c => c.propertyId === 'p231' && c.period === '2026-12').length, 0);
});
test('empty future readings never become zero; first-to-first usage belongs to the previous month', () => {
  const s = state(); s.readings.push({ id: 'a', meterId: 'p231-water', date: '2026-01-01', value: 858 });
  assert.equal(intervals(s, 'p231-water').length, 0);
  s.readings.push({ id: 'b', meterId: 'p231-water', date: '2026-02-01', value: 870 });
  const u = usage(s, 'water', 2026, 'p231');
  assert.equal(u[0].value, 12); assert.equal(u[1].value, null); assert.equal(intervals(s, 'p231-water')[0].period, '2026-01');
});
test('missing-month interval is not fabricated into monthly totals; replacement starts a new series', () => {
  const s = state(); s.readings.push({ id: 'a', meterId: 'p231-water', date: '2026-01-01', value: 858 }, { id: 'b', meterId: 'p231-water', date: '2026-03-01', value: 880 });
  assert.equal(intervals(s, 'p231-water')[0].value, 22); assert.equal(intervals(s, 'p231-water')[0].period, null);
  s.meters.find(m => m.id === 'p231-water').retired = true;
  s.meters.push({ id: 'new', propertyId: 'p231', type: 'water', retired: false, due: '' });
  s.readings.push({ id: 'c', meterId: 'new', date: '2026-03-01', value: 0 }, { id: 'd', meterId: 'new', date: '2026-04-01', value: 8 });
  validateState(s); assert.equal(intervals(s, 'new')[0].value, 8);
});
test('invalid, descending, duplicate readings and overlapping contracts are rejected', () => {
  for (const value of [null, -1, NaN]) { const s = state(); s.readings.push({ id: 'a', meterId: 'p231-water', date: '2026-01-01', value }); assert.throws(() => validateState(s)); }
  const s = state(); s.readings.push({ id: 'a', meterId: 'p231-water', date: '2026-01-01', value: 100 }, { id: 'b', meterId: 'p231-water', date: '2026-02-01', value: 99 }); assert.throws(() => validateState(s));
  const t = state(); t.contracts.push({ ...t.contracts[0], id: 'duplicate' }); assert.throws(() => validateState(t));
});
test('rent day clips to last day of February and real zero consumption remains zero', () => {
  assert.equal(dueDate('2026-02', 31), '2026-02-28'); assert.equal(dueDate('2028-02', 31), '2028-02-29');
  const s = state(); s.readings.push({ id: 'a', meterId: 'p231-water', date: '2026-01-01', value: 0 }, { id: 'b', meterId: 'p231-water', date: '2026-02-01', value: 0 }); validateState(s); assert.equal(usage(s, 'water', 2026, 'p231')[0].value, 0);
});
test('demo data passes the same validations as real data', () => { validateState(demoState(now)); });

test('historical receipts do not invent contractual charges, arrears, or advance balances', () => {
  const s = state(); s.settings.accountingStart = '2026-01-01';
  s.contracts.push({ id: 'archive', propertyId: 'p741', start: '2026-01-01', end: '2026-10-31', rent: 0, dueDay: 1, historyOnly: true, tenant: 'Архив', overrides: {} });
  s.payments.push({ ...payment('history', 'p741', 35000, 'rent', '2026-08-01', '2026-08'), contractId: 'archive', datePrecision: 'month' });
  validateState(s);
  const rows = charges(s, '2026-10', now).filter(c => c.contractId === 'archive');
  assert.equal(rows.find(c => c.period === '2026-08').paid, 35000);
  assert.ok(rows.every(c => c.amount === null && c.debt === 0 && c.status === 'recorded'));
  assert.equal(finances(s, { year: 2026, now }).rent, 35000);
  s.contracts.at(-1).overrides['2026-08'] = 40000;
  const confirmed = charges(s, '2026-08', now).find(c => c.contractId === 'archive' && c.period === '2026-08');
  assert.equal(confirmed.amount, 40000); assert.equal(confirmed.debt, 5000);
});
