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
    readings: [], payments: [], expenses: [], tariffs: [], importKeys: [],
  };
}
export function activeContract(s, propertyId, date = today()) { return s.contracts.filter(c => c.propertyId === propertyId && c.start <= date && (!c.end || c.end >= date)).sort((a, b) => b.start.localeCompare(a.start))[0]; }
export function contractForMonth(s, propertyId, period) { const end = dueDate(period, 31); return s.contracts.filter(c => c.propertyId === propertyId && c.start <= end && (!c.end || c.end >= period + '-01')).sort((a, b) => b.start.localeCompare(a.start))[0]; }
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
      const due = dueDate(m, c.dueDay);
      const debt = historicalUnknown ? 0 : Math.max(0, cents(amount) - cents(paid)) / 100;
      out.push({ id: `${c.id}-${m}`, propertyId: p.id, contractId: c.id, tenant: c.tenant, period: m, amount, paid, debt, due: historicalUnknown ? '' : due, status: historicalUnknown ? 'recorded' : debt === 0 ? 'paid' : due < now ? 'late' : paid > 0 ? 'partial' : 'pending' });
      }
    }
  }
  return out;
}
export function finances(s, { year, month = 'all', propertyId = 'all', now = today() }) {
  const accepts = x => x.date <= now && x.date.slice(0, 4) === String(year) && (month === 'all' || x.date.slice(5, 7) === String(month).padStart(2, '0')) && (propertyId === 'all' || x.propertyId === propertyId);
  const rented = id => s.properties.find(p => p.id === id)?.use === 'rental';
  const ps = s.payments.filter(accepts);
  const es = s.expenses.filter(e => e.paid && e.payer === 'owner' && accepts({ ...e, date: e.paidDate || e.date }));
  const sum = xs => xs.reduce((a, x) => a + cents(x.amount), 0) / 100;
  const rent = sum(ps.filter(p => p.kind === 'rent' && rented(p.propertyId)));
  const reimbursements = sum(ps.filter(p => p.kind === 'reimbursement' && rented(p.propertyId)));
  const expenses = sum(es.filter(e => rented(e.propertyId)));
  const homeExpenses = sum(es.filter(e => !rented(e.propertyId)));
  return { rent, reimbursements, expenses, homeExpenses, profit: (cents(rent) + cents(reimbursements) - cents(expenses)) / 100, remaining: (cents(rent) + cents(reimbursements) - cents(expenses) - cents(homeExpenses)) / 100 };
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
