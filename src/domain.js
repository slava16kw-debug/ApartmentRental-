export const RESOURCES = { water: { label: 'Вода', unit: 'м³', color: '#468acb' }, gas: { label: 'Газ', unit: 'м³', color: '#c38a44' }, power: { label: 'Электроэнергия', unit: 'кВт·ч', color: '#8c75c9' } };
export const CATEGORIES = ['ЖКХ', 'Вода', 'Газ', 'Электроэнергия', 'Капремонт', 'Интернет', 'Домофон', 'Вывоз мусора', 'Ремонт и обслуживание', 'Мебель и техника', 'Поверка счётчиков', 'Налоги по аренде', 'Прочее'];
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const uid = () => crypto.randomUUID();
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
export const monthOf = d => String(d).slice(0, 7);
export const cents = n => Math.round(Number(n) * 100);
export const money = n => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
export const number = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n || 0);
export function isDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d; }
export function addMonths(m, n = 1) { const [y, x] = m.split('-').map(Number); const d = new Date(Date.UTC(y, x - 1 + n, 1)); return d.toISOString().slice(0, 7); }
export function monthRange(from, to) { const out = []; for (let m = from; m <= to && out.length < 600; m = addMonths(m)) out.push(m); return out; }
export function dueDate(period, day) { const [y, m] = period.split('-').map(Number); return `${period}-${String(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, '0')}`; }
export function daysUntil(d, now = today()) { return Math.round((Date.parse(d) - Date.parse(now)) / 86400000); }
export function initialState(config = {}, now = today()) {
  const properties = config.properties || [
    { id: 'p231', title: 'Квартира 231', address: '', use: 'rental', color: 'mint' },
    { id: 'p741', title: 'Квартира 741', address: '', use: 'rental', color: 'sand' },
    { id: 'p17', title: 'Наш дом', address: '', use: 'home', color: 'lilac' },
  ];
  const start = monthOf(now) + '-01';
  return {
    schemaVersion: 1,
    settings: { accountingStart: start, annualGoal: 1000000, reminderDays: 30 },
    properties,
    contracts: properties.filter(p => p.use === 'rental').map((p, i) => ({ id: 'c-' + p.id, propertyId: p.id, tenant: '', phone: '', start, end: '', rent: i === 0 ? 50000 : 35000, dueDay: i === 0 ? 6 : 21, deposit: i === 0 ? 50000 : 35000, note: 'Уточните арендатора и дату начала договора.' })),
    meters: properties.flatMap(p => Object.keys(RESOURCES).map(type => ({ id: `${p.id}-${type}`, propertyId: p.id, type, serial: '', due: config.meterDates?.[p.id]?.[type] || '', retired: false }))),
    readings: [], payments: [], expenses: [], tariffs: [], importKeys: [], utilities: { items: [], marks: {}, propertyNotes: {} },
  };
}
export function activeContract(s, propertyId, date = today()) { return s.contracts.filter(c => c.propertyId === propertyId && c.start <= date && (!c.end || c.end >= date)).sort((a, b) => b.start.localeCompare(a.start))[0]; }
export function contractForMonth(s, propertyId, period) { const end = dueDate(period, 31); return s.contracts.filter(c => c.propertyId === propertyId && c.start <= end && (!c.end || c.end >= period + '-01')).sort((a, b) => b.start.localeCompare(a.start))[0]; }
export function contractDueDay(contract) { return contract?.dueDayFromStart && isDate(contract.start) ? Number(contract.start.slice(8, 10)) : contract?.dueDay; }
export function paidFor(s, contractId, period, now = today()) { return s.payments.filter(p => p.kind === 'rent' && p.contractId === contractId && p.period === period && p.date <= now).reduce((a, p) => a + cents(p.amount), 0) / 100; }
export function charges(s, through = monthOf(today()), now = today()) {
  const out = [];
  for (const m of monthRange(monthOf(s.settings.accountingStart), through)) {
    for (const p of s.properties.filter(p => p.use === 'rental')) {
      // A contract's first and last incomplete months are manually adjustable.
      const contracts = s.contracts.filter(c => c.propertyId === p.id && c.start <= dueDate(m, 31) && (!c.end || c.end >= m + '-01'));
      for (const c of contracts) {
      // Imported cash receipts do not establish the original contractual debt.
      const historicalUnknown = c.historyOnly === true && !Object.hasOwn(c.overrides || {}, m);
      const amount = historicalUnknown ? null : c.overrides?.[m] ?? c.rent;
      const paid = paidFor(s, c.id, m, now);
      const due = m === monthOf(c.start) && c.firstDueDate ? c.firstDueDate : dueDate(m, contractDueDay(c));
      const debt = historicalUnknown ? 0 : Math.max(0, cents(amount) - cents(paid)) / 100;
      out.push({ id: `${c.id}-${m}`, propertyId: p.id, contractId: c.id, tenant: c.tenant, period: m, amount, paid, debt, due: historicalUnknown ? '' : due, status: historicalUnknown ? 'recorded' : debt === 0 ? 'paid' : due < now ? 'late' : paid > 0 ? 'partial' : 'pending' });
      }
    }
  }
  return out;
}
export function receivedRentPayments(s, { year, month = 'all', propertyId = 'all', now = today() }) {
  const rentals = new Set(s.properties.filter(p => p.use === 'rental').map(p => p.id));
  return s.payments.filter(p => p.kind === 'rent' && rentals.has(p.propertyId) && p.date <= now && p.date.slice(0, 4) === String(year) && (month === 'all' || p.date.slice(5, 7) === String(month).padStart(2, '0')) && (propertyId === 'all' || p.propertyId === propertyId));
}
export function paymentMethodKey(method) {
  return method === 'Наличные' ? 'cash' : method === 'Перевод' ? 'transfer' : method === 'Другое' ? 'other' : 'unspecified';
}
export function finances(s, { year, month = 'all', propertyId = 'all', now = today() }) {
  const accepts = x => x.date <= now && x.date.slice(0, 4) === String(year) && (month === 'all' || x.date.slice(5, 7) === String(month).padStart(2, '0')) && (propertyId === 'all' || x.propertyId === propertyId);
  const rented = id => s.properties.find(p => p.id === id)?.use === 'rental';
  const ps = s.payments.filter(accepts);
  const es = s.expenses.filter(e => e.paid && e.payer === 'owner' && accepts({ ...e, date: e.paidDate || e.date }));
  const sum = xs => xs.reduce((a, x) => a + cents(x.amount), 0) / 100;
  const rentPayments = receivedRentPayments(s, { year, month, propertyId, now });
  const recordedRent = sum(rentPayments);
  const rentMethods = Object.fromEntries(['cash', 'transfer', 'other', 'unspecified'].map(key => [key, sum(rentPayments.filter(p => paymentMethodKey(p.method) === key))]));
  const confirmation = propertyId === 'all' && month === 'all' && `${year}-12-31` <= now ? s.settings.annualRentTotals?.[year] : null;
  const rent = confirmation ? confirmation.amount : recordedRent;
  const rentAdjustment = (cents(rent) - cents(recordedRent)) / 100;
  const reimbursements = sum(ps.filter(p => p.kind === 'reimbursement' && rented(p.propertyId)));
  const expenses = sum(es.filter(e => rented(e.propertyId)));
  const homeExpenses = sum(es.filter(e => !rented(e.propertyId)));
  return { rent, recordedRent, rentAdjustment, rentMethods, reimbursements, expenses, homeExpenses, profit: (cents(rent) + cents(reimbursements) - cents(expenses)) / 100, remaining: (cents(rent) + cents(reimbursements) - cents(expenses) - cents(homeExpenses)) / 100 };
}
export function rentPotential(s, { year, propertyId = 'all', now = today() }) {
  const properties = s.properties.filter(p => p.use === 'rental' && (propertyId === 'all' || p.id === propertyId)).map(p => {
    // Known contracts supply full monthly rates. Archive-only contracts have no
    // known charges: estimate their rates from rent received for each period,
    // with explicit full-month rates for confirmed partial-month receipts.
    const contracts = s.contracts.filter(c => c.propertyId === p.id && !c.historyOnly).sort((a, b) => a.start.localeCompare(b.start));
    const archive = s.contracts.filter(c => c.propertyId === p.id && c.historyOnly);
    const timeline = contracts.map(c => ({ period: monthOf(c.start), rate: c.rent, source: 'contract', contractId: c.id }));
    for (const c of archive) {
      const received = new Map();
      for (const payment of s.payments.filter(x => x.propertyId === p.id && x.contractId === c.id && x.kind === 'rent' && x.date <= now && x.amount > 0)) {
        received.set(payment.period, (received.get(payment.period) || 0) + cents(payment.amount));
      }
      for (const period of new Set([...received.keys(), ...Object.keys(c.potentialRates || {})])) {
        const confirmed = Object.hasOwn(c.potentialRates || {}, period);
        timeline.push({ period, rate: confirmed ? c.potentialRates[period] : received.get(period) / 100, source: confirmed ? 'confirmed' : 'receipts', contractId: c.id });
      }
    }
    timeline.sort((a, b) => a.period.localeCompare(b.period));
    const months = monthRange(`${year}-01`, `${year}-12`).map(period => {
      const end = dueDate(period, 31);
      const c = contracts.filter(c => c.start <= end && (!c.end || c.end >= period + '-01')).at(-1);
      if (c) return { period, rate: c.rent, source: 'contract', contractId: c.id, assumed: false };
      const nearest = timeline.filter(x => x.period <= period).at(-1) || timeline[0];
      return { period, rate: nearest?.rate ?? null, source: nearest?.source || 'unknown', contractId: nearest?.contractId, assumed: !!nearest && nearest.period !== period };
    });
    const rent = months.some(m => m.rate === null) ? null : months.reduce((sum, m) => sum + cents(m.rate), 0) / 100;
    return { propertyId: p.id, rent, months };
  });
  return { properties, rent: properties.some(p => p.rent === null) ? null : properties.reduce((sum, p) => sum + cents(p.rent), 0) / 100 };
}
export function occupiedRentPlan(s, { year, propertyId = 'all', now = today() }) {
  const properties = s.properties.filter(p => p.use === 'rental' && (propertyId === 'all' || p.id === propertyId)).map(p => {
    const archiveIds = new Set(s.contracts.filter(c => c.propertyId === p.id && c.historyOnly).map(c => c.id));
    const months = monthRange(`${year}-01`, `${year}-12`).map(period => {
      const contracts = s.contracts.filter(c => c.propertyId === p.id && c.start <= dueDate(period, 31) && (!c.end || c.end >= period + '-01'));
      // Contractual amounts include unpaid months and negotiated partial months.
      // Archive receipts fill periods whose original obligations are unknown.
      const known = contracts.filter(c => !c.historyOnly || Object.hasOwn(c.overrides || {}, period));
      const knownIds = new Set(known.map(c => c.id));
      const contracted = known.reduce((sum, c) => sum + cents(c.overrides?.[period] ?? c.rent), 0);
      const archive = s.payments.filter(x => x.propertyId === p.id && x.kind === 'rent' && x.period === period && x.date <= now && archiveIds.has(x.contractId) && !knownIds.has(x.contractId));
      const historical = archive.reduce((sum, x) => sum + cents(x.amount), 0);
      return { period, amount: (contracted + historical) / 100, contracted: contracted / 100, historical: historical / 100, source: known.length ? 'contracts' : archive.length ? 'history' : 'vacant' };
    });
    return { propertyId: p.id, rent: months.reduce((sum, m) => sum + cents(m.amount), 0) / 100, months };
  });
  return { properties, rent: properties.reduce((sum, p) => sum + cents(p.rent), 0) / 100 };
}
export function rentVacancyLoss(s, { year, propertyId = 'all', now = today() }) {
  const potential = rentPotential(s, { year, propertyId, now });
  const plan = occupiedRentPlan(s, { year, propertyId, now });
  const months = monthRange(`${year}-01`, `${year}-12`).map((period, i) => {
    const properties = potential.properties.map(p => {
      const covered = s.contracts.some(c => c.propertyId === p.propertyId && c.start <= dueDate(period, 31)) || s.payments.some(x => x.propertyId === p.propertyId && x.kind === 'rent' && x.period === period && x.date <= now);
      const rate = p.months[i].rate;
      const planned = plan.properties.find(x => x.propertyId === p.propertyId).months[i].amount;
      // Missing years before the first known lease are not recorded as vacancy.
      // Unpaid rent under a known lease remains in the plan and is not a loss.
      return { propertyId: p.propertyId, amount: !covered || rate === null ? null : Math.max(0, cents(rate) - cents(planned)) / 100 };
    });
    return { period, amount: properties.some(p => p.amount === null) ? null : properties.reduce((sum, p) => sum + cents(p.amount), 0) / 100, properties };
  });
  return { rent: months.some(m => m.amount === null) ? null : months.reduce((sum, m) => sum + cents(m.amount), 0) / 100, months };
}
export function intervals(s, meterId) {
  const meter = s.meters.find(m => m.id === meterId);
  const readings = s.readings.filter(r => r.meterId === meterId).sort((a, b) => a.date.localeCompare(b.date));
  return readings.slice(1).map((r, i) => {
    const prev = readings[i];
    const complete = prev.date.endsWith('-01') && r.date.endsWith('-01') && addMonths(monthOf(prev.date)) === monthOf(r.date);
    const tariff = s.tariffs.filter(t => t.propertyId === meter?.propertyId && t.type === meter?.type && t.start <= prev.date).sort((a, b) => b.start.localeCompare(a.start))[0];
    const value = Math.round((r.value - prev.value) * 1000) / 1000;
    return { from: prev.date, to: r.date, period: complete ? monthOf(prev.date) : null, value, meterId, propertyId: meter?.propertyId, type: meter?.type, estimate: tariff ? Math.round(value * tariff.rate * 100) / 100 : null };
  });
}
export function usage(s, type, year, propertyId = 'all') {
  const all = s.meters.filter(m => m.type === type && (propertyId === 'all' || m.propertyId === propertyId)).flatMap(m => intervals(s, m.id));
  return Array.from({ length: 12 }, (_, i) => {
    const period = `${year}-${String(i + 1).padStart(2, '0')}`;
    const rows = all.filter(x => x.period === period);
    return { period, value: rows.length ? Math.round(rows.reduce((a, x) => a + x.value, 0) * 1000) / 1000 : null, count: rows.length };
  });
}
export function validateState(s) {
  if (!s || s.schemaVersion !== 1 || !Array.isArray(s.properties) || s.properties.length > 30) throw Error('Неверный формат резервной копии.');
  for (const key of ['contracts', 'meters', 'readings', 'payments', 'expenses', 'tariffs', 'importKeys']) if (!Array.isArray(s[key]) || s[key].length > 30000) throw Error('Некорректный раздел: ' + key);
  if (!isDate(s.settings?.accountingStart) || !Number.isFinite(s.settings.annualGoal) || s.settings.annualGoal < 0) throw Error('Проверьте настройки периода и цели.');
  const confirmations = s.settings.annualRentTotals;
  if (confirmations !== undefined && (!confirmations || typeof confirmations !== 'object' || Array.isArray(confirmations) || Object.entries(confirmations).some(([year, row]) => !/^20\d{2}$/.test(year) || !row || !Number.isFinite(row.amount) || row.amount < 0 || row.amount > 1e10))) throw Error('Проверьте подтверждённые годовые итоги аренды.');
  if (s.utilities !== undefined) {
    const u=s.utilities;
    if (!u || !Array.isArray(u.items) || u.items.length>300 || !u.marks || typeof u.marks!=='object' || Array.isArray(u.marks) || Object.keys(u.marks).length>600 || !u.propertyNotes || typeof u.propertyNotes!=='object' || Array.isArray(u.propertyNotes)) throw Error('Неверный формат данных ЖКХ.');
    const ids=new Set();
    for (const x of u.items) {
      if (typeof x.id!=='string' || !x.id || ids.has(x.id) || !s.properties.some(p=>p.id===x.propertyId) || typeof x.label!=='string' || !x.label.trim() || x.label.length>120 || typeof x.due!=='string' || x.due.length>150 || !Number.isFinite(x.average) || x.average<0 || x.average>1e7 || !['monthly','quarterly','annual','other'].includes(x.frequency) || typeof x.active!=='boolean' || typeof x.note!=='string' || x.note.length>1000) throw Error('Проверьте название, квартиру, сроки и среднюю сумму квитанции ЖКХ.');
      ids.add(x.id);
    }
    for (const [period,marks] of Object.entries(u.marks)) {
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period) || !marks || typeof marks!=='object' || Array.isArray(marks) || Object.entries(marks).some(([id,color])=>!ids.has(id)||!['red','green','orange'].includes(color))) throw Error('Проверьте месяц и цвет отметки ЖКХ.');
    }
    if (Object.entries(u.propertyNotes).some(([id,note])=>!s.properties.some(p=>p.id===id)||typeof note!=='string'||note.length>1000)) throw Error('Проверьте примечания к квартире в ЖКХ.');
  }
  const allIds = new Set();
  for (const key of ['properties', 'contracts', 'meters', 'readings', 'payments', 'expenses', 'tariffs']) {
    for (const x of s[key]) {
      if (typeof x.id !== 'string' || !x.id || allIds.has(key + x.id)) throw Error('Повторяющийся или отсутствующий идентификатор.');
      allIds.add(key + x.id);
      if (JSON.stringify(x).length > 12000) throw Error('Слишком длинная запись.');
      if (key !== 'properties' && key !== 'readings' && !s.properties.some(p => p.id === x.propertyId)) throw Error('Квартира не найдена.');
    }
  }
  for (const p of s.properties) if (!['rental', 'home'].includes(p.use) || typeof p.title !== 'string' || !p.title.trim()) throw Error('Укажите название и назначение квартиры.');
  for (const c of s.contracts) {
    if (!isDate(c.start) || (c.end && (!isDate(c.end) || c.end < c.start)) || !Number.isFinite(c.rent) || c.rent < 0 || !Number.isInteger(c.dueDay) || c.dueDay < 1 || c.dueDay > 31) throw Error('Проверьте даты, ставку и день оплаты договора.');
    if (c.firstDueDate && (!isDate(c.firstDueDate) || monthOf(c.firstDueDate) !== monthOf(c.start))) throw Error('Дата первого платежа должна быть в месяце начала договора.');
    if (c.dueDayFromStart !== undefined && typeof c.dueDayFromStart !== 'boolean') throw Error('Проверьте привязку дня оплаты к дате договора.');
    if (c.potentialRates && (typeof c.potentialRates !== 'object' || Array.isArray(c.potentialRates) || Object.entries(c.potentialRates).some(([m, v]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || !Number.isFinite(v) || v < 0 || v > 1e10))) throw Error('Проверьте месячные ставки для расчёта потенциальной аренды.');
    if (c.overrides && Object.entries(c.overrides).some(([m, v]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || !Number.isFinite(v) || v < 0)) throw Error('Неверная сумма начисления.');
    for (const other of s.contracts.filter(x => x.propertyId === c.propertyId && x.id !== c.id)) if (c.start <= (other.end || '9999-12-31') && other.start <= (c.end || '9999-12-31')) throw Error('Периоды договоров одной квартиры пересекаются. Завершите предыдущие условия.');
  }
  for (const key of ['payments', 'expenses']) for (const x of s[key]) {
    const zeroRent = key === 'payments' && x.kind === 'rent' && x.amount === 0;
    if (!Number.isFinite(x.amount) || (x.amount <= 0 && !zeroRent) || x.amount > 1e10 || !isDate(x.date)) throw Error('Укажите корректную дату и сумму. Для аренды допустим 0 ₽, для остальных операций — положительная сумма.');
    if (key === 'payments') {
      if (!['rent', 'reimbursement', 'deposit_in', 'deposit_out'].includes(x.kind)) throw Error('Неверный вид платежа.');
      if (x.datePrecision && !['day', 'month'].includes(x.datePrecision)) throw Error('Укажите точность даты платежа.');
      if (x.kind === 'rent' && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.period) || (!(zeroRent && !x.contractId) && !s.contracts.some(c => c.id === x.contractId && c.propertyId === x.propertyId)))) throw Error('Выберите договор и месяц оплаты. Без договора можно записать только 0 ₽.');
    }
    if (key === 'expenses' && (!['owner', 'tenant'].includes(x.payer) || (x.paid && !isDate(x.paidDate || x.date)))) throw Error('Проверьте плательщика и дату оплаты расхода.');
  }
  for (const m of s.meters) if (!RESOURCES[m.type] || (m.due && !isDate(m.due))) throw Error('Проверьте тип прибора и дату поверки.');
  for (const m of s.meters) {
    let previous = -Infinity, date = '';
    for (const r of s.readings.filter(r => r.meterId === m.id).sort((a, b) => a.date.localeCompare(b.date))) {
      if (!isDate(r.date) || !Number.isFinite(r.value) || r.value < 0 || r.value < previous || r.date === date) throw Error('Показания должны возрастать; на одну дату допускается одна запись. При замене создайте новый прибор.');
      previous = r.value; date = r.date;
    }
  }
  if (s.readings.some(r => !s.meters.some(m => m.id === r.meterId))) throw Error('Счётчик для показания не найден.');
  for (const t of s.tariffs) if (!RESOURCES[t.type] || !isDate(t.start) || !Number.isFinite(t.rate) || t.rate < 0) throw Error('Проверьте тариф.');
  return s;
}
export function demoState(now = today()) {
  const s = initialState({}, now), year = now.slice(0, 4), last = Number(now.slice(5, 7));
  s.settings.accountingStart = `${year}-01-01`;
  s.contracts.forEach((c, i) => { c.start = `${year}-01-01`; c.tenant = i ? 'Арендатор второй квартиры' : 'Арендатор первой квартиры'; c.note = ''; });
  for (let m = 1; m <= last; m++) {
    const period = `${year}-${String(m).padStart(2, '0')}`;
    s.contracts.forEach(c => { const date = dueDate(period, c.dueDay); if (date <= now) s.payments.push({ id: `demo-${c.id}-${m}`, propertyId: c.propertyId, contractId: c.id, kind: 'rent', date, period, amount: c.rent, method: 'Перевод', note: '' }); });
    for (const p of s.properties) s.expenses.push({ id: `de-${p.id}-${m}`, propertyId: p.id, category: m === 4 && p.id === 'p741' ? 'Ремонт и обслуживание' : 'ЖКХ', amount: p.use === 'home' ? 6200 + m * 31 : m === 4 ? 8000 : 1800 + m * 23, date: period + '-05', paid: true, paidDate: period + '-05', payer: 'owner', note: '' });
  }
  for (const meter of s.meters) {
    let value = meter.type === 'power' ? 17000 : meter.type === 'gas' ? 10000 : 800;
    meter.due = meter.propertyId === 'p741' && meter.type === 'water' ? `${year}-12-18` : `${Number(year) + 3}-06-15`;
    for (let m = 1; m <= last; m++) {
      value += meter.type === 'power' ? 120 + m * 7 + (meter.propertyId === 'p17' ? 130 : 0) : meter.type === 'gas' ? Math.round(80 + Math.abs(6 - m) * 23) : 10 + m % 4;
      s.readings.push({ id: `dr-${meter.id}-${m}`, meterId: meter.id, date: `${year}-${String(m).padStart(2, '0')}-01`, value, note: '' });
    }
  }
  return s;
}
