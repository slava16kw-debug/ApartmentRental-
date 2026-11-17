import { MONTHS, RESOURCES, today, monthOf, money, number, cents, activeContract, charges, finances, rentPotential, intervals, daysUntil } from './domain.js';
import { icon } from './icons.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = d => d ? d.split('-').reverse().join('.') : 'Укажите дату';
const period = (year, i) => `${year}-${String(i + 1).padStart(2, '0')}`;
const types = ['water', 'gas', 'power'];
const actual = p => p.date <= today();
const amount = xs => xs.reduce((sum, x) => sum + Math.round(x.amount * 100), 0) / 100;

export function workbookYears(state, selected) {
  return [...new Set([today().slice(0, 4), String(selected), ...state.readings.map(r => r.date.slice(0, 4)), ...state.payments.map(p => p.date.slice(0, 4)), ...state.expenses.map(e => e.date.slice(0, 4))])].sort().reverse();
}
export function workbookTheme(state, propertyId) {
  const index = state.properties.findIndex(p => p.id === propertyId);
  return ['sheet-blue', 'sheet-gold', 'sheet-green'][index % 3];
}
function zeroRecorded(state, propertyId, per) {
  return (state.importHistory || []).some(b => b.zeroReceipts?.some(r => r.propertyId === propertyId && r.period === per && r.amount === 0));
}
function readingAt(state, propertyId, type, at) {
  const meterIds = new Set(state.meters.filter(m => m.propertyId === propertyId && m.type === type).map(m => m.id));
  return state.readings.filter(r => meterIds.has(r.meterId) && r.date === at).sort((a, b) => Number(!!state.meters.find(m => m.id === a.meterId)?.retired) - Number(!!state.meters.find(m => m.id === b.meterId)?.retired));
}
function readingCell(state, p, type, per) {
  const at = per + '-01', rows = readingAt(state, p.id, type, at), r = rows[0];
  const multi = rows.length > 1 ? ` · ${rows.length} прибора на дату, предыдущие показания доступны в истории` : '';
  return `<td class="sheet-number sheet-reading ${workbookTheme(state, p.id)}" data-property="${esc(p.id)}" data-resource="${type}" data-period="${per}"><button type="button" class="sheet-cell-button ${r ? '' : 'sheet-empty-cell'}" data-action="${r ? 'edit-reading' : 'readings'}" data-id="${esc(r ? r.id : p.id)}" data-date="${at}" ${!r && at > today() ? 'disabled' : ''} title="${esc(`${p.title} · ${RESOURCES[type].label} на ${date(at)}${multi}${r ? ' · изменить показание' : ' · внести показание'}`)}">${r ? number(r.value) + (rows.length > 1 ? '*' : '') : '<span aria-hidden="true">·</span><span class="sr-only">Нет показания</span>'}</button></td>`;
}
function rentCell(state, p, per, allCharges) {
  const payments = state.payments.filter(x => x.propertyId === p.id && x.kind === 'rent' && x.period === per && actual(x));
  const got = amount(payments), knownZero = zeroRecorded(state, p.id, per);
  const cs = allCharges.filter(c => c.propertyId === p.id && c.period === per && c.amount !== null);
  const expected = cs.reduce((sum, c) => sum + c.amount, 0);
  const action = payments.length === 1 ? 'edit-payment' : payments.length > 1 ? 'sheet-payments' : 'payment';
  const id = payments.length === 1 ? payments[0].id : p.id;
  const hasActual = payments.length > 0 || knownZero;
  const label = payments.length ? number(got) : knownZero ? '0' : expected ? `${number(expected)}<small>${per > monthOf(today()) ? 'план' : 'ожидается'}</small>` : '—';
  const title = hasActual ? `${p.title} · получено за ${MONTHS[Number(per.slice(5)) - 1].toLowerCase()}: ${money(got)}${got === 0 ? ' · поступления не было' : ''}${knownZero && !payments.length ? ' · отмечено в Excel' : ''}` : expected ? `${p.title} · ожидается ${money(expected)}, получение не отмечено` : `${p.title} · нет данных об оплате за этот месяц`;
  return `<td class="sheet-rent ${workbookTheme(state, p.id)} ${hasActual ? got > 0 ? 'sheet-rent-received' : 'sheet-rent-zero' : 'sheet-rent-pending'}" data-property="${esc(p.id)}" data-period="${per}"><button type="button" class="sheet-cell-button" data-action="${action}" data-id="${esc(id)}" data-period="${per}" title="${esc(title)}">${label}</button></td>`;
}
function groupHead(state, p, span) {
  const c = activeContract(state, p.id), theme = workbookTheme(state, p.id);
  return `<th colspan="${span}" class="sheet-property-head ${theme}" scope="colgroup" data-property="${esc(p.id)}"><div><span>${esc(p.address || p.title)}</span><button type="button" data-action="property" data-id="${esc(p.id)}" aria-label="Настройки: ${esc(p.title)}">${icon('edit')}</button></div><small>${p.use === 'home' ? 'Живём сами' : c ? `Текущая аренда: ${money(c.rent)} · оплата ${c.dueDay}-го числа` : 'Сейчас не сдаётся'}</small></th>`;
}
function columns(properties, financial = false) {
  return `<colgroup>${properties.map(p => `<col class="sheet-col-num"><col class="sheet-col-month"><col class="sheet-col-reading"><col class="sheet-col-reading"><col class="sheet-col-power">${financial && p.use === 'rental' ? '<col class="sheet-col-rent">' : ''}`).join('')}${financial ? '<col class="sheet-col-total"><col class="sheet-col-total"><col class="sheet-col-total">' : ''}</colgroup>`;
}
function headerCells(state, p, rent) {
  return `<th class="${workbookTheme(state, p.id)}" scope="col">№</th><th class="${workbookTheme(state, p.id)}" scope="col">Месяц</th><th class="${workbookTheme(state, p.id)}" scope="col">Хол.вода<small>м³</small></th><th class="${workbookTheme(state, p.id)}" scope="col">Газ<small>м³</small></th><th class="${workbookTheme(state, p.id)}" scope="col">Электричество<small>кВт·ч</small></th>${rent && p.use === 'rental' ? `<th class="${workbookTheme(state, p.id)}" scope="col">Забрал аренду<small>₽ за месяц</small></th>` : ''}`;
}
function verificationCells(state, p) {
  return `<th colspan="2" class="${workbookTheme(state, p.id)}" scope="row">Срок поверки</th>${types.map(type => {
    const m = state.meters.find(m => m.propertyId === p.id && m.type === type && !m.retired);
    if (!m) return '<td>—</td>';
    const cls = !m.due ? 'sheet-due-missing' : daysUntil(m.due) < 0 ? 'sheet-due-late' : daysUntil(m.due) <= state.settings.reminderDays ? 'sheet-due-soon' : 'sheet-due-ok';
    return `<td class="${cls}"><button class="sheet-cell-button" type="button" data-action="meter" data-id="${esc(m.id)}" title="${esc(`${p.title} · ${RESOURCES[type].label} · поверка${m.due ? ': ' + date(m.due) : ' не указана'}`)}">${date(m.due)}</button></td>`;
  }).join('')}${p.use === 'rental' ? `<td class="sheet-contract-cell"><button type="button" class="sheet-cell-button" data-action="contract:${esc(p.id)}">Договор</button></td>` : ''}`;
}
function potentialRow(state, properties, yearly, potential) {
  const profit = potential.rent === null ? null : (cents(potential.rent) + cents(yearly.reimbursements) - cents(yearly.expenses)) / 100;
  return `<tr class="sheet-potential-total" aria-label="Потенциал за год при полной загрузке">${properties.map(p => {
    if (p.use !== 'rental') return `<th colspan="2" class="${workbookTheme(state, p.id)}" scope="row">Своё жильё</th><td colspan="3" class="sheet-total-note">В потенциал аренды не входит</td>`;
    const estimate = potential.properties.find(x => x.propertyId === p.id);
    const rates = new Set(estimate.months.map(m => m.rate));
    const formula = estimate.rent === null ? 'Укажите арендную ставку в договоре' : rates.size === 1 ? `12 мес. × ${money(estimate.months[0].rate)}` : '12 месяцев · ставки по месяцам';
    const detail = estimate.rent === null ? formula : estimate.months.map(m => `${MONTHS[Number(m.period.slice(5)) - 1]}: ${money(m.rate)}${m.assumed ? ' (ближайшая известная ставка)' : ''}`).join('; ');
    return `<th colspan="2" class="${workbookTheme(state, p.id)}" scope="row">Потенциал за год</th><td colspan="3" class="sheet-total-note ${workbookTheme(state, p.id)}" title="${esc(detail)}">Полная загрузка · ${formula}</td><td class="sheet-rent-year ${workbookTheme(state, p.id)}" data-potential-property="${esc(p.id)}" title="${esc(detail)}">${estimate.rent === null ? '—' : number(estimate.rent)}</td>`;
  }).join('')}<td class="sheet-potential-value" data-potential="rent" title="Потенциальная аренда за все 12 месяцев без простоев">${potential.rent === null ? '—' : number(potential.rent)}</td><td class="sheet-number" title="Уже оплаченные расходы по аренде; будущие расходы не рассчитаны">${number(yearly.expenses)}</td><td class="sheet-potential-value" data-potential="profit" title="Потенциальная аренда + внесённые возмещения − уже оплаченные расходы по аренде">${profit === null ? '—' : number(profit) + '<small>по внесённым расходам</small>'}</td></tr>`;
}
export function renderWorkbook(state, filter) {
  const properties = filter.propertyId === 'all' ? state.properties : state.properties.filter(p => p.id === filter.propertyId);
  const year = String(filter.year), yearly = finances(state, { year, propertyId: filter.propertyId });
  const potential = rentPotential(state, { year, propertyId: filter.propertyId });
  const receivedRatio = potential.rent > 0 ? cents(yearly.rent) / cents(potential.rent) : null;
  const receivedPercent = receivedRatio === null ? '—' : new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(receivedRatio);
  const methodSummary = [['cash', 'Наличными:'], ['transfer', 'Переводом:'], ...(yearly.rentMethods.other ? [['other', 'Другое:']] : []), ...(yearly.rentMethods.unspecified ? [['unspecified', 'Способ не указан:']] : [])].map(([key, label]) => `<div class="sheet-summary-pair"><span>${label}</span><button type="button" class="sheet-method-value sheet-method-${key}" data-action="rent-methods" data-rent-method-summary="${key}" aria-label="${esc(label)} ${money(yearly.rentMethods[key])}. Изменить способы получения аренды" title="Изменить способы получения аренды">${money(yearly.rentMethods[key])}${icon('edit')}</button></div>`).join('');
  const methodsSection = `<section class="sheet-rent-methods" aria-label="Способы получения аренды"><h3>Способы получения аренды · ${year}</h3><div class="sheet-method-summary">${methodSummary}</div>${yearly.rentAdjustment ? `<p class="sheet-method-note">Способы получения рассчитаны по записям на ${money(yearly.recordedRent)}; сверка ${money(yearly.rentAdjustment)} по ним пока не распределена.</p>` : ''}</section>`;
  const allCharges = charges(state, `${year}-12`), years = workbookYears(state, year);
  const reconciliationRow = yearly.rentAdjustment ? `<tr class="sheet-reconciliation-row"><th colspan="${properties.reduce((n,p) => n + (p.use === 'rental' ? 6 : 5), 0)}" scope="row">Сверка подтверждённого итога года · по месяцам и квартирам пока не распределена</th><td class="sheet-number">${number(yearly.rentAdjustment)}</td><td class="sheet-number">—</td><td class="sheet-number">${number(yearly.rentAdjustment)}</td></tr>` : '';
  let accumulated = 0;
  const data = Array.from({ length: 12 }, (_, i) => {
    const per = period(year, i), f = finances(state, { year, month: String(i + 1).padStart(2, '0'), propertyId: filter.propertyId });
    accumulated += f.profit;
    return { per, f, accumulated, hasFinancialData: f.expenses !== 0 || f.reimbursements !== 0 || state.payments.some(p => ['rent', 'reimbursement'].includes(p.kind) && actual(p) && monthOf(p.date) === per && (filter.propertyId === 'all' || p.propertyId === filter.propertyId)) || (state.importHistory || []).some(b => b.zeroReceipts?.some(x => x.period === per && (filter.propertyId === 'all' || x.propertyId === filter.propertyId))) };
  });
  return `<section class="workbook" aria-label="Годовой лист показаний и аренды">
    <div class="sheet-summary" aria-label="Годовая финансовая сводка">
      <div class="sheet-summary-pair"><span class="sheet-plan-label">${year === today().slice(0, 4) ? 'План аренды' : 'Текущая цель'}${icon('calendar')}</span><button data-action="preferences" type="button" class="sheet-plan-value" title="Изменить годовой план">${money(state.settings.annualGoal)}</button><small class="summary-hint">Ваша цель на год · изменить</small></div>
      <div class="sheet-summary-pair"><span>Потенциальная аренда${icon('building')}</span><strong class="sheet-potential-summary" data-summary="rent-potential" title="За все 12 месяцев при полной загрузке, по ставкам договоров">${potential.rent === null ? '—' : money(potential.rent)}</strong><small class="summary-hint">12 месяцев без простоев</small></div>
      <div class="sheet-summary-pair"><span>Получено за год${icon('wallet')}</span><strong class="sheet-actual-value" data-summary="rent">${money(yearly.rent)}</strong><small class="summary-hint">Фактические поступления</small></div>
      <div class="sheet-summary-pair"><span>Расходы по аренде${icon('receipt')}</span><strong class="sheet-expense-value" data-summary="expenses" title="Оплаченные собственником расходы сдаваемых квартир за выбранный год">${money(yearly.expenses)}</strong><small class="summary-hint">Оплачено за выбранный год</small></div>
      <div class="sheet-summary-pair"><span>Итоговая прибыль${icon('up')}</span><strong class="sheet-profit-value ${yearly.profit < 0 ? 'negative' : ''}" data-summary="profit" title="Полученная аренда + возмещения − оплаченные расходы по аренде">${money(yearly.profit)}</strong><small class="summary-hint">С учётом расходов и возмещений</small></div>
      <div class="sheet-summary-pair summary-ratio"><span>Получено от потенциала${icon('chart')}</span><strong class="sheet-percent-value" data-summary="rent-percent" title="Полученная аренда ÷ потенциальная аренда за полный год × 100%">${receivedPercent}</strong><small class="summary-hint">Доля полученной аренды</small>${receivedRatio === null ? '' : `<div class="summary-progress" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, receivedRatio * 100))}%"></i></div>`}</div>
    </div>
    <section class="sheet-ledger-panel" aria-labelledby="annual-ledger-title"><div class="sheet-caption"><div><h2 id="annual-ledger-title">Годовой обзор <span>${year}</span></h2><p>Показания на 1-е число · аренда · расходы</p></div><span>${icon('edit')}Нажмите на ячейку, чтобы изменить запись</span></div>
    <div class="sheet-scroll" role="region" aria-label="Таблица показаний всех квартир, прокручивается по горизонтали" tabindex="0"><table class="sheet-table sheet-readings-table" aria-label="Показания счётчиков и арендные платежи за ${year}">${columns(properties, true)}<thead><tr>${properties.map(p => groupHead(state, p, p.use === 'rental' ? 6 : 5)).join('')}<th colspan="3" class="sheet-financial-head" scope="colgroup">Аренда и расходы<small>по фактическим датам денег</small></th></tr><tr>${properties.map(p => headerCells(state, p, true)).join('')}<th class="sheet-financial-head">За месяц<small>получено, ₽</small></th><th class="sheet-financial-head">Расходы<small>по аренде, ₽</small></th><th class="sheet-financial-head">Итого<small>прибыль нарастающим, ₽</small></th></tr></thead>
    <tbody>${data.map(({ per, f, accumulated, hasFinancialData }, i) => `<tr class="${per === monthOf(today()) ? 'sheet-current-month' : ''} ${filter.month === String(i + 1).padStart(2, '0') ? 'sheet-selected-month' : ''}" data-period="${per}">${properties.map(p => `<td class="sheet-index ${workbookTheme(state, p.id)}">${i + 1}</td><th class="sheet-month ${workbookTheme(state, p.id)}" scope="row">${MONTHS[i]}</th>${types.map(type => readingCell(state, p, type, per)).join('')}${p.use === 'rental' ? rentCell(state, p, per, allCharges) : ''}`).join('')}<td class="sheet-month-total">${hasFinancialData ? number(f.rent) : '—'}</td><td class="sheet-number">${f.expenses ? number(f.expenses) : '—'}</td><td class="sheet-running-total">${hasFinancialData ? number(accumulated) : '—'}</td></tr>`).join('')}</tbody>
    <tfoot>${reconciliationRow}<tr class="sheet-year-total">${properties.map(p => `<th colspan="2" class="${workbookTheme(state, p.id)}" scope="row">Факт за год</th><td colspan="3" class="sheet-total-note ${workbookTheme(state, p.id)}">${p.use === 'rental' ? 'Полученная арендная плата →' : 'Расходы своего жилья: ' + money(finances(state, { year, propertyId: p.id }).homeExpenses)}</td>${p.use === 'rental' ? `<td class="sheet-rent-year ${workbookTheme(state, p.id)}">${number(amount(state.payments.filter(x => x.propertyId === p.id && x.kind === 'rent' && x.period?.startsWith(year + '-') && actual(x))))}</td>` : ''}`).join('')}<td class="sheet-final-total">${number(yearly.rent)}</td><td class="sheet-number">${number(yearly.expenses)}</td><td class="sheet-final-total">${number(yearly.profit)}</td></tr>${potentialRow(state, properties, yearly, potential)}<tr class="sheet-verification-row">${properties.map(p => verificationCells(state, p)).join('')}<td colspan="3" class="sheet-total-note">${icon('info')}Красная дата — поверка просрочена</td></tr></tfoot></table></div></section>
    <div class="sheet-legend"><span><i class="legend-received"></i>Получено</span><span><i class="legend-planned"></i>План / ожидается — ещё не доход</span><span>· Нет показания</span><span>0 — зафиксированный ноль</span><span class="sheet-scroll-hint">${icon('arrow')}Таблицу можно прокручивать вправо</span></div>
    <p class="sheet-potential-note">Потенциал — все 12 месяцев без простоев. При смене ставки используем последнюю ставку месяца, а для месяцев без договора — ближайшую известную. Прибыль учитывает внесённые возмещения и оплаченные расходы; будущие расходы не рассчитаны.</p>
    ${resourceTable(state, properties, year)}
    <div class="sheet-bottom-grid"><section class="sheet-box"><div class="sheet-box-heading"><h2>Расходы по квартирам</h2><button class="text-button" data-action="expense">${icon('plus')}Добавить расход</button></div>${expensesTable(state, filter)}${methodsSection}</section><section class="sheet-box"><div class="sheet-box-heading"><h2>Итоги ${year} года</h2><button class="text-button" data-view="reports">Отчёт ${icon('arrow')}</button></div><table class="sheet-totals-table"><tbody><tr><th>Получено аренды</th><td>${money(yearly.rent)}</td></tr><tr><th>Возмещения расходов</th><td>${money(yearly.reimbursements)}</td></tr><tr><th>Оплачено по аренде</th><td>${money(yearly.expenses)}</td></tr><tr class="sheet-profit-row"><th>Прибыль от аренды</th><td>${money(yearly.profit)}</td></tr><tr><th>Расходы своего жилья</th><td>${money(yearly.homeExpenses)}</td></tr></tbody></table></section></div>
    <div class="sheet-page-details">${state.settings.importNotice ? `<div class="info-banner">${icon('info')}<span>${esc(state.settings.importNotice)}</span></div>` : ''}
    <div class="sheet-toolbar"><span>${icon('file')}Годовой лист · ${year}</span><span>Все суммы в рублях</span><button type="button" class="text-button" data-action="export">${icon('download')}Скачать Excel</button></div>
    </div>
    <nav class="sheet-year-tabs" aria-label="Листы по годам"><span>${icon('file')}Листы</span>${years.map(y => `<button type="button" data-action="sheet-year:${y}" class="${y === year ? 'active' : ''}" aria-pressed="${y === year}">${y}</button>`).join('')}<button type="button" class="sheet-chart-tab" data-view="analytics">${icon('chart')}Графики</button></nav>
  </section>`;
}
function resourceTable(state, properties, year) {
  const perProperty = Object.fromEntries(properties.map(p => [p.id, types.reduce((a, type) => {
    a[type] = Array.from({ length: 12 }, (_, i) => {
      const rows = state.meters.filter(m => m.propertyId === p.id && m.type === type).flatMap(m => intervals(state, m.id)).filter(x => x.period === period(year, i));
      return rows.length ? Math.round(rows.reduce((sum, x) => sum + x.value, 0) * 1000) / 1000 : null;
    }); return a;
  }, {})]));
  const sum = xs => xs.some(x => x !== null) ? xs.reduce((a, v) => a + (v ?? 0), 0) : null;
  const avg = xs => { const known = xs.filter(v => v !== null); return known.length ? sum(known) / known.length : null; };
  return `<div class="sheet-section-title"><h2>Расход ресурсов</h2><span>Разница между показаниями · автоматически</span></div><div class="sheet-scroll" role="region" aria-label="Расход ресурсов по месяцам, прокручивается по горизонтали" tabindex="0"><table class="sheet-table sheet-usage-table" aria-label="Расход воды, газа и электричества за ${year}">${columns(properties)}<thead><tr>${properties.map(p => groupHead(state, p, 5)).join('')}</tr><tr>${properties.map(p => headerCells(state, p, false)).join('')}</tr></thead><tbody>${Array.from({ length: 12 }, (_, i) => `<tr data-period="${period(year, i)}">${properties.map(p => `<td class="sheet-index ${workbookTheme(state, p.id)}">${i + 1}</td><th class="sheet-month ${workbookTheme(state, p.id)}" scope="row">${MONTHS[i]}</th>${types.map(type => `<td class="sheet-number ${workbookTheme(state, p.id)}" data-property="${esc(p.id)}" data-resource="${type}">${perProperty[p.id][type][i] === null ? '—' : number(perProperty[p.id][type][i])}</td>`).join('')}`).join('')}</tr>`).join('')}</tbody><tfoot>${[['Всего за год', sum], ['Среднее за заполненный месяц', avg]].map(([label, fn]) => `<tr class="sheet-resource-summary">${properties.map(p => `<th colspan="2" class="${workbookTheme(state, p.id)}" scope="row">${label}</th>${types.map(type => `<td class="sheet-number ${workbookTheme(state, p.id)}">${fn(perProperty[p.id][type]) === null ? '—' : number(fn(perProperty[p.id][type]))}</td>`).join('')}`).join('')}</tr>`).join('')}</tfoot></table></div><p class="sheet-footnote">Показания на 1 февраля минус показания на 1 января — расход за январь. Если следующего показания ещё нет, расход остаётся пустым. Залоги учитываются отдельно от аренды.</p>`;
}
function expensesTable(state, filter) {
  const rows = state.expenses.filter(e => (e.paid ? e.paidDate || e.date : e.date).startsWith(String(filter.year) + '-') && (filter.propertyId === 'all' || e.propertyId === filter.propertyId)).sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="table-wrap"><table class="sheet-expenses-table"><thead><tr><th>Дата</th><th>Квартира</th><th>Поломка / расход</th><th>Стоимость, ₽</th><th>Оплата</th></tr></thead><tbody>${rows.length ? rows.map(e => `<tr><td>${date(e.date)}</td><td>${esc(state.properties.find(p => p.id === e.propertyId)?.title)}</td><td><button class="sheet-cell-button" type="button" data-action="expense" data-id="${esc(e.id)}">${esc(e.note || e.category)}</button></td><td class="sheet-number">${number(e.amount)}</td><td>${e.paid ? 'Оплачено' : 'Ожидается'}</td></tr>`).join('') : '<tr><td colspan="5" class="sheet-no-expenses">Расходы за этот год пока не внесены. Добавьте их, чтобы получить полный результат по прибыли.</td></tr>'}</tbody></table></div>`;
}
