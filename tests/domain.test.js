import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, finances, rentPotential, charges, usage, intervals, dueDate, demoState } from '../src/domain.js';
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

test('confirmed closed-year rent reconciles only the annual portfolio total without inventing cash movements', () => {
  const s = initialState({}, '2024-01-01');
  s.payments.push(payment('one', 'p231', 10000, 'rent', '2024-01-06', '2024-01'), payment('two', 'p741', 20000, 'rent', '2024-02-21', '2024-02'));
  s.settings.annualRentTotals = { '2024': { amount: 29000, note: 'Месячная детализация уточняется' } };
  validateState(s);
  const before = JSON.stringify(s), f = finances(s, { year: 2024, now });
  assert.equal(f.recordedRent, 30000); assert.equal(f.rent, 29000); assert.equal(f.rentAdjustment, -1000); assert.equal(f.profit, 29000);
  assert.equal(finances(s, { year: 2024, month: '02', now }).rent, 20000);
  assert.equal(finances(s, { year: 2024, propertyId: 'p741', now }).rent, 20000);
  assert.equal(finances(s, { year: 2024, now: '2024-02-22' }).rent, 30000);
  assert.equal(JSON.stringify(s), before);
  s.payments[1].amount = 19000;
  assert.equal(finances(s, { year: 2024, now }).rentAdjustment, 0, 'Resolving a monthly discrepancy clears the derived difference');
  for (const confirmations of [null, [], {'2024':{amount:-1}}, {'2024':{amount:NaN}}, {'invalid':{amount:100}}]) {
    s.settings.annualRentTotals = confirmations; assert.throws(() => validateState(s));
  }
});

test('full occupancy potential includes vacant months without changing actual rent or charges', () => {
  const s = state();
  s.contracts.find(c => c.propertyId === 'p741').start = '2026-11-16';
  s.contracts[0].overrides = { '2026-11': 0 };
  s.contracts.push({ id: 'archive', propertyId: 'p741', start: '2026-01-01', end: '2026-10-31', rent: 0, dueDay: 21, historyOnly: true });
  s.payments.push(payment('unpaid', 'p741', 0));
  const before = JSON.stringify(s), actualCharges = charges(s, '2026-12', now);
  const potential = rentPotential(s, { year: 2026 });
  assert.equal(potential.rent, 1020000);
  assert.deepEqual(potential.properties.map(p => [p.propertyId, p.rent]), [['p231', 600000], ['p741', 420000]]);
  assert.equal(potential.properties[1].months.filter(m => m.assumed).length, 10);
  assert.equal(rentPotential(s, { year: 2026, propertyId: 'p17' }).rent, 0);
  assert.equal(finances(s, { year: 2026, now }).rent, 0);
  assert.deepEqual(charges(s, '2026-12', now), actualCharges);
  assert.equal(JSON.stringify(s), before);
});

test('potential follows rate changes, carries the rate through vacancy, and reports missing rates', () => {
  const s = state();
  s.contracts[0].start = '2026-01-01'; s.contracts[0].end = '2026-06-30';
  s.contracts.push({ id: 'changed', propertyId: 'p231', start: '2026-09-16', end: '', rent: 55000.25, dueDay: 16, overrides: { '2026-09': 10000 } });
  const potential = rentPotential(s, { year: 2026, propertyId: 'p231' });
  assert.equal(potential.rent, 620001);
  assert.equal(potential.properties[0].months[6].rate, 50000);
  assert.equal(potential.properties[0].months[6].assumed, true);
  assert.equal(potential.properties[0].months[8].rate, 55000.25);
  assert.equal(rentPotential(s, { year: 2025, propertyId: 'p231' }).rent, 600000);
  assert.equal(rentPotential(s, { year: 2027, propertyId: 'p231' }).rent, 660003);
  s.contracts = s.contracts.filter(c => c.propertyId !== 'p741');
  assert.equal(rentPotential(s, { year: 2026 }).rent, null);
  s.contracts.push({ id: 'zero-rate', propertyId: 'p741', start: '2026-01-01', end: '', rent: 0, dueDay: 1 });
  assert.equal(rentPotential(s, { year: 2026, propertyId: 'p741' }).rent, 0);
});

test('first rent due date is independent of the recurring day and never creates a receipt', () => {
  const s = state(), c = s.contracts.find(c => c.propertyId === 'p741');
  c.start = '2026-11-16'; c.firstDueDate = '2026-11-16'; c.dueDay = 21;
  validateState(s);
  const rows = charges(s, '2026-12', now).filter(x => x.contractId === c.id);
  assert.equal(rows[0].due, '2026-11-16'); assert.equal(rows[0].amount, 35000); assert.equal(rows[0].status, 'pending');
  assert.equal(rows[1].due, '2026-12-21');
  assert.equal(finances(s, { year: 2026, now: '2026-11-17' }).rent, 0);
  assert.equal(charges(s, '2026-11', '2026-11-17').find(x => x.contractId === c.id).status, 'late');
  for (const value of ['2026-12-16', '2026-11-31', 'invalid']) { c.firstDueDate = value; assert.throws(() => validateState(s)); }
  c.firstDueDate = ''; validateState(s);
  assert.equal(charges(s, '2026-11', now).find(x => x.contractId === c.id).due, '2026-11-21');
});

test('zero rent records are allowed with or without a tenant and preserve contractual debt', () => {
  const s = state();
  s.contracts = s.contracts.filter(c => c.propertyId !== 'p741');
  s.payments.push(payment('unpaid', 'p231', 0), { ...payment('vacant', 'p741', 0), contractId: '' });
  validateState(s);
  assert.equal(finances(s, { year: 2026, now }).rent, 0);
  assert.equal(finances(s, { year: 2026, now }).profit, 0);
  assert.equal(charges(s, '2026-11', now).find(c => c.propertyId === 'p231').debt, 50000);
  assert.ok(!charges(s, '2026-11', now).some(c => c.propertyId === 'p741'));
  for (const changes of [{ amount: -1 }, { amount: null }, { amount: NaN }, { amount: 0, kind: 'deposit_in' }, { amount: 0, kind: 'deposit_out' }, { amount: 0, kind: 'reimbursement' }, { amount: 0, contractId: 'missing' }, { amount: 1, contractId: '' }, { amount: 0, period: '2026-13' }]) {
    const invalid = state(); invalid.payments.push({ ...payment('invalid', 'p231', 0), ...changes });
    assert.throws(() => validateState(invalid), JSON.stringify(changes));
  }
  const expense = state(); expense.expenses.push({ id: 'empty-expense', propertyId: 'p231', amount: 0, date: now, payer: 'owner', paid: false });
  assert.throws(() => validateState(expense));
});

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
