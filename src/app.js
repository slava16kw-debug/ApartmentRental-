import { RESOURCES, CATEGORIES, MONTHS, uid, today, monthOf, money, number, addMonths, monthRange, dueDate, daysUntil, initialState, activeContract, contractForMonth, paidFor, charges, finances, intervals, usage, validateState, demoState } from './domain.js';
import { icon, buildingArt } from './icons.js';
import { renderWorkbook, workbookYears } from './workbook.js';
import { readWorkbook, exportWorkbook, exportCSV } from './spreadsheet.js';

const app = document.querySelector('#app');
const root = document.querySelector('#modal-root');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortDate = d => d ? d.split('-').reverse().join('.') : 'Не указана';
const shortPeriod = p => p ? MONTHS[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(0, 4) : '—';
const options = (xs, selected) => xs.map(([value, label]) => `<option value="${esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('');
const btn = (label, action, name = 'plus', cls = '') => `<button type="button" class="btn ${cls}" data-action="${action}">${icon(name)}${label}</button>`;
const statusBadge = status => ({ paid: '<span class="badge green">Получено</span>', late: '<span class="badge red">Просрочено</span>', partial: '<span class="badge amber">Частично</span>', pending: '<span class="badge grey">Ожидается</span>', recorded: '<span class="badge grey">Из Excel</span>' })[status] || '';
const paymentDate = p => p.datePrecision === 'month' ? `${shortPeriod(monthOf(p.date))}<span class="muted">Точный день не указан</span>` : shortDate(p.date);
const resourceIcon = t => ({ water: 'drop', gas: 'flame', power: 'bolt' })[t];
let state, realState, revision = 0, busy = false, demo = false, currentView = 'overview', meterTab = 'meters', paymentTab = 'charges', sidebarOpen = false;
let filter = { year: today().slice(0, 4), month: today().slice(5, 7), propertyId: 'all' };
let selectedImport = [];
const titles = { overview: ['Показания счётчиков', 'Годовой лист: три квартиры, показания, аренда и расходы.'], analytics: ['Обзор портфеля', 'Доходы, расходы и потребление на графиках.'], properties: ['Мои квартиры', 'Договоры, условия аренды и история изменений.'], payments: ['Аренда и платежи', 'Начисления отдельно. Полученные деньги — под контролем.'], meters: ['Счётчики', 'Показания, потребление и сроки поверки.'], expenses: ['Расходы', 'Каждая трата на своём месте.'], reports: ['Финансовый отчёт', 'Прозрачный результат по фактически полученным и оплаченным суммам.'], settings: ['Настройки', 'Учёт, импорт истории и резервные копии.'] };
const property = id => state.properties.find(p => p.id === id);
const propertyOptions = selected => options(state.properties.map(p => [p.id, p.title]), selected);
const selectedProperty = () => filter.propertyId === 'all' ? state.properties : state.properties.filter(p => p.id === filter.propertyId);
const dateFilter = d => d.slice(0, 4) === filter.year && (filter.month === 'all' || d.slice(5, 7) === filter.month);

async function boot() {
  try {
    const r = await fetch('/api/portfolio', { cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) throw Error(data.error || 'Не удалось загрузить данные.');
    state = validateState(data.state); revision = data.revision; render();
  } catch (e) {
    app.innerHTML = `<div class="loading"><span class="loading-mark">⌂</span><h2>Мои квартиры</h2><p>${esc(e.message)}</p>${btn('Попробовать снова', 'retry', 'refresh', 'primary')}</div>`;
  }
}
function toast(message) { const t = document.querySelector('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 4200); }
async function mutate(fn, message = 'Сохранено') {
  if (busy) throw Error('Дождитесь сохранения предыдущей записи.');
  const next = structuredClone(state); fn(next); validateState(next);
  if (demo) { state = next; render(); toast('Изменено только в демонстрационном режиме'); return; }
  busy = true; document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = true);
  try {
    const r = await fetch('/api/portfolio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, state: next }) });
    const data = await r.json();
    if (!r.ok) throw Error(data.error || 'Не удалось сохранить. Попробуйте ещё раз.');
    revision = data.revision; state = next; render(); toast(message);
  } finally { busy = false; document.querySelectorAll('button[type="submit"]').forEach(b => b.disabled = false); }
}
function render() {
  const [title, subtitle] = titles[currentView];
  const rentalCount = state.properties.filter(p => p.use === 'rental').length;
  const nav = [['overview', 'file', 'Годовая таблица'], ['analytics', 'chart', 'Графики'], ['properties', 'building', 'Квартиры'], ['payments', 'wallet', 'Аренда и платежи'], ['meters', 'gauge', 'Счётчики'], ['expenses', 'receipt', 'Расходы'], ['reports', 'chart', 'Отчёты'], ['settings', 'settings', 'Настройки']];
  app.innerHTML = `<div class="layout sheet-app">
    <aside class="sidebar ${sidebarOpen ? 'open' : ''}">
      <a class="brand" href="#overview" data-view="overview"><span class="brand-mark">${icon('home')}</span><span><span class="brand-name">Мои квартиры</span><span class="brand-sub" style="display:block">Учёт аренды и счётчиков</span></span></a>
      <div class="sidebar-caption">УПРАВЛЕНИЕ</div>
      <nav class="nav" aria-label="Основная навигация">${nav.map(([id, ic, name]) => `<button class="${currentView === id ? 'active' : ''}" data-view="${id}">${icon(ic)}${name}${id === 'properties' ? `<span class="count">${state.properties.length}</span>` : ''}</button>`).join('')}</nav>
      <div class="side-bottom"><div class="side-note">${icon('leaf')}<strong>Больше порядка.<br>Меньше забот.</strong>Ваша недвижимость и её финансы всегда под рукой.</div><div class="account"><span class="avatar">МК</span><div><strong>Личный кабинет</strong><p>Приватное пространство</p></div><a href="/signout-with-chatgpt?return_to=/" target="_top" title="Выйти" style="margin-left:auto">${icon('exit')}</a></div></div>
    </aside>
    <main class="main">
      <div class="topbar"><div class="mobile-top-left"><button class="mobile-menu" data-action="menu" aria-label="Открыть меню">${icon('menu')}</button><span class="mobile-brand">${icon('home')}Мои квартиры</span><div class="breadcrumb">${icon('home')}<span>Мои квартиры</span><span>/</span><strong>${esc(title)}</strong></div></div><div class="top-actions"><button class="text-button" data-action="demo">${icon(demo ? 'exit' : 'chart')}<span>${demo ? 'Выйти из примера' : 'Посмотреть пример'}</span></button><span class="sync"><i class="dot"></i>${demo ? 'Демо' : 'В облаке'}</span></div></div>
      <header class="header"><div><div class="eyebrow">${currentView === 'overview' ? 'УЧЁТ ПО КВАРТИРАМ' : 'МОИ КВАРТИРЫ'}</div><h1>${esc(title)}</h1><p class="subtitle">${currentView === 'overview' ? `${filter.year} год · ${state.properties.length} квартиры · ${rentalCount} в аренде · ${state.properties.length - rentalCount} для себя` : esc(subtitle)}</p></div><div class="header-actions">${currentView === 'settings' ? btn('Резервная копия', 'backup', 'download') : `${btn('Внести показания', 'readings', 'gauge')}${btn('Расход', 'expense', 'plus')}${btn('Получена аренда', 'payment', 'plus', 'primary')}`}</div></header>
      ${demo ? `<div class="demo-banner">${icon('info')}<span><strong>Демонстрационные данные.</strong> Это пример интерфейса. Ваши реальные записи хранятся отдельно.</span><button class="text-button" data-action="demo">Вернуться к своим данным ${icon('arrow')}</button></div>` : ''}
      ${currentView === 'overview' ? workbookFilters() : currentView !== 'settings' && currentView !== 'properties' ? filters() : ''}
      ${state.settings.importNotice ? `<div class="info-banner">${icon('info')}<span>${esc(state.settings.importNotice)}</span></div>` : ''}
      <div id="view">${({ overview: () => renderWorkbook(state, filter), analytics: dashboard, properties: propertiesView, payments: paymentsView, meters: metersView, expenses: expensesView, reports: reportsView, settings: settingsView })[currentView]()}</div>
      <footer class="footer"><span>${icon('shield')}Доступ только у вас · Данные сохраняются на сервере</span><span>Мои квартиры · Учёт по годам</span></footer>
    </main></div>`;
}
function workbookFilters() {
  return `<div class="filters"><label class="select-wrap">${icon('calendar')}<select aria-label="Год" data-filter="year">${options(workbookYears(state, filter.year).map(y => [y, y + ' год']), filter.year)}</select></label><label class="select-wrap">${icon('building')}<select aria-label="Квартира" data-filter="propertyId">${options([['all', 'Все квартиры рядом'], ...state.properties.map(p => [p.id, p.title])], filter.propertyId)}</select></label><span class="filter-label">${icon('file')}Годовой лист · все 12 месяцев</span></div>`;
}
function filters() {
  const years = new Set([today().slice(0, 4), filter.year, ...state.payments.map(p => p.date.slice(0, 4)), ...state.readings.map(p => p.date.slice(0, 4)), ...state.expenses.map(p => p.date.slice(0, 4))]);
  return `<div class="filters"><label class="select-wrap">${icon('calendar')}<select aria-label="${currentView === 'overview' ? 'Выделить месяц' : 'Месяц'}" title="${currentView === 'overview' ? 'Выделить строку; в таблице всегда виден весь год' : 'Период отчёта'}" data-filter="month">${options([['all', currentView === 'overview' ? 'Все месяцы' : 'Весь год'], ...MONTHS.map((m, i) => [String(i + 1).padStart(2, '0'), m])], filter.month)}</select></label><label class="select-wrap"><select aria-label="Год" data-filter="year">${options([...years].sort().reverse().map(y => [y, y]), filter.year)}</select></label><label class="select-wrap">${icon('building')}<select aria-label="Квартира" data-filter="propertyId">${options([['all', 'Все квартиры'], ...state.properties.map(p => [p.id, p.title])], filter.propertyId)}</select></label><span class="filter-label">${icon('clock')}${currentView === 'overview' ? 'Годовой лист · все 12 месяцев' : 'Обновляется после каждой записи'}</span></div>`;
}
function kpi(label, value, foot, ic = 'wallet', cls = '') { const action = label === 'Прибыль за год' ? 'year' : label.includes('Прибыль') ? 'profit' : label.includes('Расходы') ? 'expenses' : 'rent'; return `<button type="button" class="kpi ${cls}" data-action="metric:${action}" style="text-align:left;color:inherit"><div class="kpi-top">${label}${icon(ic)}</div><div class="kpi-value ${value < 0 ? 'negative' : ''}">${money(value)}</div><div class="kpi-foot">${foot}</div></button>`; }
function dashboard() {
  const f = finances(state, filter), y = finances(state, { ...filter, month: 'all' });
  const expected = selectedProperty().reduce((a, p) => a + (activeContract(state, p.id)?.rent || 0), 0);
  const noData = state.payments.length + state.readings.length + state.expenses.length === 0;
  const periodLabel = filter.month === 'all' ? 'за выбранный год' : 'за выбранный месяц';
  return `${noData ? `<div class="info-banner">${icon('info')}<span><strong>Начнём с первой записи.</strong> Условия аренды уже добавлены. Историю из Excel можно перенести с предварительной проверкой.</span><button class="text-button" data-action="import">Импортировать ${icon('arrow')}</button></div>` : ''}
    <div class="kpi-grid">${kpi('Получено аренды', f.rent, `${icon('check')}Фактические поступления ${periodLabel}`, 'wallet')}${kpi('Прибыль от аренды', f.profit, `${icon('up')}После расходов сдаваемых квартир`, 'chart', 'highlight')}${kpi('Расходы по аренде', f.expenses, `${icon('receipt')}Только оплаченные собственником`, 'receipt')}${kpi('Прибыль за год', y.profit, `${icon('calendar')}С января по ${shortDate(today())}`, 'calendar')}</div>
    <div class="section-head"><h2>Мои квартиры <span>${state.properties.length}</span></h2><button class="text-button" data-view="properties">Управление квартирами ${icon('arrow')}</button></div>
    <div class="property-grid">${selectedProperty().map(p => propertyCard(p)).join('')}</div>
    <div class="charts-grid"><section class="panel"><div class="section-head"><div><h2>Доходы и расходы</h2><p>Фактические платежи · ${filter.year} год</p></div><div class="legend"><span><i style="background:#4f8660"></i>Аренда</span><span><i style="background:#c8b68c"></i>Расходы</span></div></div>${financeChart()}</section><section class="panel"><div class="section-head"><h2>Требует внимания</h2><span class="muted">${icon('bell')}</span></div>${attention()}</section></div>
    <div class="section-head"><div><h2>Потребление ресурсов</h2><p>По показаниям счётчиков · фактический интервал</p></div><button class="text-button" data-view="meters">Все показания ${icon('arrow')}</button></div>
    <div class="resource-grid">${Object.keys(RESOURCES).map(t => resourceCard(t)).join('')}</div>
    <p class="accounting-note">${icon('info')} Расходы собственного жилья за период: <strong>${money(f.homeExpenses)}</strong>. Плановая аренда при действующих ставках: <strong>${money(expected)}/мес.</strong></p>`;
}
function propertyCard(p, detailed = false) {
  const c = activeContract(state, p.id), f = finances(state, { ...filter, propertyId: p.id });
  const m = filter.month === 'all' ? today().slice(5, 7) : filter.month;
  const ch = charges(state, `${filter.year}-${m}`).find(x => x.propertyId === p.id && x.period === `${filter.year}-${m}`);
  return `<article class="property"><div class="property-cover ${esc(p.color)}"><span class="cover-label ${p.use === 'home' ? 'home' : ''}"><i class="dot"></i>${p.use === 'home' ? 'ЖИВЁМ САМИ' : c ? 'В АРЕНДЕ' : 'СВОБОДНА'}</span>${buildingArt(p.color, p.use === 'home')}</div><div class="property-body"><div class="property-title"><h3>${esc(p.title)}</h3><button class="icon-btn" data-action="property" data-id="${p.id}" aria-label="Редактировать квартиру">${icon('edit')}</button></div><p class="property-address">${esc(p.address || 'Добавьте адрес в настройках квартиры')}</p><div class="property-tenant">${icon(p.use === 'home' ? 'home' : 'user')}${p.use === 'home' ? 'Наше личное пространство' : esc(c?.tenant || 'Арендатор пока не указан')}</div><div class="property-numbers"><div><p>${p.use === 'home' ? 'Расходы за период' : 'Арендная плата'}</p><strong>${money(p.use === 'home' ? f.homeExpenses : c?.rent || 0)}</strong>${p.use === 'rental' ? '<span> / мес.</span>' : ''}</div>${p.use === 'rental' ? `<div style="text-align:right"><p>Прибыль за период</p><span class="${f.profit < 0 ? 'negative' : 'positive'}" style="font-size:12px">${money(f.profit)}</span></div>` : `<span class="badge purple">Своё жильё</span>`}</div><div class="property-status">${p.use === 'home' ? `<span>В семейном бюджете отдельно</span><button class="text-button" data-action="readings" data-id="${p.id}">${icon('plus')}Показания</button>` : `${ch ? statusBadge(ch.status) : '<span class="badge grey">Без начисления</span>'}<span>Оплата ${c?.dueDay || '—'}-го числа</span>`}</div>${detailed ? `<div style="display:flex;gap:7px;margin-top:14px">${btn('Условия аренды', 'contract:' + p.id, 'file', 'small-btn')}${c ? btn('Завершить', 'end-contract:' + c.id, 'clock', 'small-btn') : ''}</div>` : ''}</div></article>`;
}
function financeChart(mode = 'cash') {
  const rows = Array.from({ length: 12 }, (_, i) => finances(state, { year: filter.year, month: String(i + 1).padStart(2, '0'), propertyId: filter.propertyId }));
  if (mode === 'profit') {
    let sum = 0;
    return lineChart(rows.map((r, i) => ({ label: MONTHS[i].slice(0, 3), value: (sum += r.profit) })), '#4e8059', 180, 'Появится после первого платежа');
  }
  const w = 600, h = 210, top = 12, bottom = 178, left = 42, right = 585;
  const max = Math.max(10000, ...rows.flatMap(r => [r.rent, r.expenses]));
  const empty = rows.every(r => !r.rent && !r.expenses);
  const step = (right - left) / 12;
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Доходы от аренды и оплаченные расходы по месяцам">${[0, .25, .5, .75, 1].map(k => `<line x1="${left}" x2="${right}" y1="${bottom - k * (bottom - top)}" y2="${bottom - k * (bottom - top)}" stroke="#edf0e9" stroke-dasharray="3 4"/><text x="${left - 9}" y="${bottom - k * (bottom - top) + 3}" text-anchor="end">${Math.round(max * k / 1000)} т.</text>`).join('')}${rows.map((r, i) => `<g><title>${MONTHS[i]}: аренда ${money(r.rent)}, расходы ${money(r.expenses)}</title><rect x="${left + i * step + 5}" y="${bottom - r.rent / max * (bottom - top)}" width="12" height="${r.rent / max * (bottom - top)}" rx="3" fill="#548563"/><rect x="${left + i * step + 20}" y="${bottom - r.expenses / max * (bottom - top)}" width="9" height="${r.expenses / max * (bottom - top)}" rx="2" fill="#cdbd98"/><text x="${left + i * step + 18}" y="201" text-anchor="middle">${MONTHS[i].slice(0, 3).toLowerCase()}</text></g>`).join('')}</svg>${empty ? `<div class="chart-empty">${icon('chart')}Первый платёж запустит ваш график</div>` : ''}</div>`;
}
function lineChart(data, color, height = 130, emptyText = 'Недостаточно показаний') {
  const w = 500, h = height, l = 10, r = 490, top = 15, bottom = h - 25;
  const vals = data.map(d => d.value).filter(v => v !== null);
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals), range = max - min || 1;
  const x = i => l + (r - l) * i / 11;
  const y = v => bottom - (v - min) / range * (bottom - top);
  const runs = []; let run = [];
  data.forEach((d, i) => { if (d.value === null) { if (run.length) runs.push(run); run = []; } else run.push([x(i), y(d.value)]); }); if (run.length) runs.push(run);
  const empty = !vals.length || (emptyText.includes('платежа') && vals.every(v => v === 0));
  return `<div class="chart" style="min-height:${height}px"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="График по месяцам">${[.2, .6, 1].map(k => `<line x1="${l}" x2="${r}" y1="${top + k * (bottom - top)}" y2="${top + k * (bottom - top)}" stroke="#edf0e8" stroke-dasharray="3 4"/>`).join('')}${runs.map(points => `<path d="${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`).join('')}${data.map((d, i) => `<g>${d.value !== null ? `<circle cx="${x(i)}" cy="${y(d.value)}" r="2.8" fill="${color}"><title>${esc(d.label)}: ${number(d.value)}</title></circle>` : ''}<text x="${x(i)}" y="${h - 5}" text-anchor="middle" style="font-size:9px">${esc(d.label)}</text></g>`).join('')}</svg>${empty ? `<div class="chart-empty">${height > 100 ? icon('chart') : ''}${emptyText}</div>` : ''}</div>`;
}
function resourceCard(type) {
  const data = usage(state, type, filter.year, filter.propertyId);
  const selected = filter.month === 'all' ? data.filter(d => d.value !== null) : data.filter(d => d.period.endsWith('-' + filter.month) && d.value !== null);
  const total = selected.reduce((a, d) => a + d.value, 0);
  const lastDate = state.readings.filter(r => { const m = state.meters.find(m => m.id === r.meterId); return m?.type === type && (filter.propertyId === 'all' || m.propertyId === filter.propertyId); }).map(r => r.date).sort().at(-1);
  return `<section class="resource-card"><div class="resource-top">${RESOURCES[type].label}<span class="resource-icon ${type}">${icon(resourceIcon(type))}</span></div><div class="resource-value"><strong>${selected.length ? number(total) : '—'}</strong><span>${RESOURCES[type].unit}</span></div>${lineChart(data.map((d, i) => ({ label: MONTHS[i].slice(0, 3).toLowerCase(), value: d.value })), RESOURCES[type].color, 75)}<div class="resource-note">${selected.length ? 'Сумма доступных месячных интервалов' : lastDate ? 'Полного интервала за выбранный месяц пока нет. Последние показания: ' + shortDate(lastDate) : 'Добавьте два последовательных показания на 1-е число'}</div></section>`;
}
function attention() {
  const items = [];
  const now = today(), period = monthOf(now);
  for (const c of charges(state, period).filter(c => c.debt > 0 && c.due < now).slice(-2)) items.push({ ic: 'wallet', color: 'red', title: `Ожидаем ${money(c.debt)}`, text: `${property(c.propertyId)?.title} · ${shortPeriod(c.period)} · срок ${shortDate(c.due)}`, action: 'payment', id: c.propertyId });
  const missing = state.meters.filter(m => !m.retired && !state.readings.some(r => r.meterId === m.id && r.date === period + '-01'));
  if (missing.length) items.push({ ic: 'gauge', color: 'green', title: 'Пора внести показания', text: `${shortPeriod(period)} · не заполнено ${missing.length} из ${state.meters.filter(m => !m.retired).length} счётчиков`, action: 'readings' });
  for (const m of state.meters.filter(m => !m.retired && m.due && daysUntil(m.due) <= state.settings.reminderDays).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 2)) items.push({ ic: 'clock', color: daysUntil(m.due) < 0 ? 'red' : '', title: `${daysUntil(m.due) < 0 ? 'Просрочена поверка' : 'Скоро поверка'}: ${RESOURCES[m.type].label.toLowerCase()}`, text: `${property(m.propertyId)?.title} · ${shortDate(m.due)}`, action: 'meter', id: m.id });
  for (const c of state.contracts.filter(c => c.end && daysUntil(c.end) >= 0 && daysUntil(c.end) <= 30).slice(0, 1)) items.push({ ic: 'file', color: '', title: 'Заканчивается договор', text: `${property(c.propertyId)?.title} · ${shortDate(c.end)}`, action: 'contract:' + c.propertyId });
  for (const e of state.expenses.filter(e => !e.paid && e.date <= now).slice(0, 1)) items.push({ ic: 'receipt', color: '', title: `Не оплачен расход ${money(e.amount)}`, text: `${property(e.propertyId)?.title} · ${e.category}`, action: 'expense', id: e.id });
  return items.length ? `<div class="attention">${items.slice(0, 4).map(i => `<div class="attention-item"><span class="attention-icon ${i.color}">${icon(i.ic)}</span><div class="attention-text"><strong>${esc(i.title)}</strong><p>${esc(i.text)}</p></div><button data-action="${i.action}" ${i.id ? `data-id="${i.id}"` : ''} aria-label="Открыть">${icon('chevron')}</button></div>`).join('')}</div>` : `<div class="empty" style="padding:25px 10px">${icon('check')}<h3>Всё под контролем</h3><p>Просроченных платежей и ближайших поверок нет.</p></div>`;
}
function propertiesView() {
  return `<div class="property-full">${state.properties.map(p => propertyCard(p, true)).join('')}</div><div class="contract-history"><div class="section-head"><h2>История условий аренды</h2></div><div class="panel table-panel">${state.contracts.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Квартира</th><th>Арендатор</th><th>Период действия</th><th>Ставка</th><th>День оплаты</th><th>Статус</th></tr></thead><tbody>${[...state.contracts].sort((a, b) => b.start.localeCompare(a.start)).map(c => `<tr><td><strong>${esc(property(c.propertyId)?.title)}</strong></td><td>${esc(c.tenant || 'Не указан')}</td><td>${shortDate(c.start)} — ${c.end ? shortDate(c.end) : 'бессрочно'}</td><td><strong>${money(c.rent)}</strong></td><td>${c.dueDay}-е число</td><td>${c.start > today() ? '<span class="badge grey">Предстоит</span>' : c.end && c.end < today() ? '<span class="badge grey">Завершён</span>' : '<span class="badge green">Действует</span>'}</td></tr>`).join('')}</tbody></table></div>` : empty('Договоров пока нет', 'Добавьте условия аренды в карточке квартиры.', 'file')}</div></div>`;
}
function paymentsView() {
  const allCharges = charges(state, `${filter.year}-12`);
  const rows = allCharges.filter(x => x.period.slice(0, 4) === filter.year && (filter.month === 'all' || x.period.slice(5, 7) === filter.month) && (filter.propertyId === 'all' || x.propertyId === filter.propertyId));
  const debt = allCharges.filter(x => x.due < today() && (filter.propertyId === 'all' || x.propertyId === filter.propertyId)).reduce((a, x) => a + x.debt, 0);
  const total = rows.reduce((a, x) => a + x.amount, 0), paid = rows.reduce((a, x) => a + x.paid, 0);
  const ps = state.payments.filter(x => dateFilter(x.date) && (filter.propertyId === 'all' || x.propertyId === filter.propertyId)).sort((a, b) => b.date.localeCompare(a.date));
  const kinds = { rent: 'Аренда', reimbursement: 'Возмещение расходов', deposit_in: 'Получен залог', deposit_out: 'Возвращён залог' };
  return `<div class="metrics-strip"><div><p>Известные начисления за период</p><strong>${money(total)}</strong></div><div><p>Оплачено по начислениям</p><strong>${money(paid)}</strong></div><div><p>Просроченная задолженность всего</p><strong class="${debt ? 'negative' : ''}">${money(debt)}</strong></div></div><div class="tabs"><button class="${paymentTab === 'charges' ? 'active' : ''}" data-payment-tab="charges">Начисления</button><button class="${paymentTab === 'history' ? 'active' : ''}" data-payment-tab="history">История получения</button><button class="${paymentTab === 'deposits' ? 'active' : ''}" data-payment-tab="deposits">Залоги</button></div>
    <div class="panel table-panel">${paymentTab === 'charges' ? rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Квартира / арендатор</th><th>За месяц</th><th>Срок оплаты</th><th>Начислено</th><th>Оплачено</th><th>Статус</th><th></th></tr></thead><tbody>${rows.sort((a, b) => a.due.localeCompare(b.due)).map(x => `<tr><td><strong>${esc(property(x.propertyId)?.title)}</strong><span class="muted">${esc(x.tenant || 'Арендатор не указан')}</span></td><td>${shortPeriod(x.period)}</td><td>${x.due ? shortDate(x.due) : 'Не указан в источнике'}</td><td>${x.amount === null ? 'Неизвестно' : money(x.amount)}</td><td><strong>${money(x.paid)}</strong></td><td>${statusBadge(x.status)}${x.amount !== null && x.paid > x.amount ? `<span class="muted">Аванс ${money(x.paid - x.amount)}</span>` : ''}</td><td class="actions"><button class="icon-btn" data-action="charge" data-id="${x.contractId}" data-period="${x.period}" aria-label="Изменить начисление">${icon('edit')}</button>${x.debt ? `<button class="btn small-btn" data-action="payment" data-id="${x.propertyId}" data-period="${x.period}">${icon('plus')}Получить</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Нет начислений за этот период', 'Начисления появляются в период действия договора, начиная с даты начала учёта.', 'calendar') : paymentTab === 'deposits' ? depositsView() : ps.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Дата</th><th>Квартира</th><th>Вид платежа</th><th>За период</th><th>Сумма</th><th>Способ</th><th></th></tr></thead><tbody>${ps.map(x => `<tr><td>${paymentDate(x)}${x.date > today() ? '<span class="muted">Будущая запись</span>' : ''}</td><td><strong>${esc(property(x.propertyId)?.title)}</strong></td><td>${kinds[x.kind]}</td><td>${x.period ? shortPeriod(x.period) : '—'}</td><td><strong>${money(x.amount)}</strong></td><td>${esc(x.method || '—')}</td><td class="actions"><button class="icon-btn" data-action="edit-payment" data-id="${x.id}" aria-label="Исправить платёж">${icon('edit')}</button><button class="icon-btn" data-action="delete:payments" data-id="${x.id}" aria-label="Удалить платёж">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : empty('Платежей пока нет', 'Нажмите «Получена аренда», когда действительно получите деньги.', 'wallet', 'Получена аренда', 'payment')}</div><p class="accounting-note">${rows.some(x => x.status === 'recorded') ? 'Архивные поступления перенесены из Excel; старые начисления и возможные долги не восстановлены. ' : ''}Учёт начислений начинается с ${shortDate(state.settings.accountingStart)}. Авансы привязаны к выбранному месяцу. Залоги не входят в арендную прибыль.</p>`;
}
function depositsView() {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Квартира</th><th>По текущему договору</th><th>Получено</th><th>Возвращено</th><th>Остаток на хранении</th></tr></thead><tbody>${selectedProperty().filter(p => p.use === 'rental').map(p => { const ps = state.payments.filter(x => x.propertyId === p.id && x.date <= today()); const received = ps.filter(x => x.kind === 'deposit_in').reduce((a, x) => a + x.amount, 0), returned = ps.filter(x => x.kind === 'deposit_out').reduce((a, x) => a + x.amount, 0); return `<tr><td><strong>${esc(p.title)}</strong></td><td>${money(activeContract(state, p.id)?.deposit || 0)}</td><td>${money(received)}</td><td>${money(returned)}</td><td><strong>${money(received - returned)}</strong></td></tr>`; }).join('')}</tbody></table></div>`;
}
function metersView() {
  const meters = state.meters.filter(m => filter.propertyId === 'all' || m.propertyId === filter.propertyId);
  return `<div class="tabs"><button data-meter-tab="meters" class="${meterTab === 'meters' ? 'active' : ''}">Приборы и поверки</button><button data-meter-tab="history" class="${meterTab === 'history' ? 'active' : ''}">Показания</button><button data-meter-tab="usage" class="${meterTab === 'usage' ? 'active' : ''}">Расход ресурсов</button></div>${meterTab === 'meters' ? `<div class="meter-list">${meters.map(m => { const last = state.readings.filter(r => r.meterId === m.id).sort((a, b) => b.date.localeCompare(a.date))[0]; const days = m.due ? daysUntil(m.due) : null; return `<article class="meter-card ${m.retired ? 'retired' : ''}"><div class="meter-card-head"><span class="resource-icon ${m.type}">${icon(resourceIcon(m.type))}</span><span class="badge ${m.retired ? 'grey' : days === null ? 'grey' : days < 0 ? 'red' : days <= state.settings.reminderDays ? 'amber' : 'green'}">${m.retired ? 'Заменён' : days === null ? 'Укажите срок' : days < 0 ? 'Поверка просрочена' : days <= state.settings.reminderDays ? 'Скоро поверка' : 'Срок в порядке'}</span></div><h3 style="margin-top:14px">${esc(property(m.propertyId)?.title)} · ${RESOURCES[m.type].label}</h3><p class="label">${esc(m.serial ? 'Прибор № ' + m.serial : 'Серийный номер не указан')}</p><div class="meter-reading">${last ? number(last.value) : '—'} <small>${RESOURCES[m.type].unit}</small></div><div class="meter-detail"><span>Последние показания</span><span>${last ? shortDate(last.date) : 'Пока нет'}</span></div><div class="meter-bottom"><span class="small muted" style="font-size:10px">Поверка: ${shortDate(m.due)}</span><button class="icon-btn" data-action="meter" data-id="${m.id}" aria-label="Настроить счётчик">${icon('edit')}</button></div></article>`; }).join('')}</div>` : meterTab === 'history' ? readingsTable(meters) : `<div class="resource-grid">${Object.keys(RESOURCES).map(resourceCard).join('')}</div><div class="panel table-panel" style="margin-top:20px">${intervalTable(meters)}</div>`}<p class="accounting-note">${icon('info')} Показания на 1 февраля минус показания на 1 января — расход за январь. Неполные и пропущенные интервалы отображаются отдельно.</p>`;
}
function readingsTable(meters) {
  const ids = new Set(meters.map(m => m.id)), rows = state.readings.filter(r => ids.has(r.meterId) && dateFilter(r.date)).sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="panel table-panel">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Дата</th><th>Квартира</th><th>Ресурс</th><th>Показание</th><th>Комментарий</th><th></th></tr></thead><tbody>${rows.map(r => { const m = state.meters.find(m => m.id === r.meterId); return `<tr><td>${shortDate(r.date)}</td><td><strong>${esc(property(m.propertyId)?.title)}</strong></td><td>${RESOURCES[m.type].label}${m.retired ? '<span class="muted">Заменённый прибор</span>' : ''}</td><td><strong>${number(r.value)} ${RESOURCES[m.type].unit}</strong></td><td>${esc(r.note || '—')}</td><td class="actions"><button class="icon-btn" data-action="edit-reading" data-id="${r.id}" aria-label="Исправить показание">${icon('edit')}</button><button class="icon-btn" data-action="delete:readings" data-id="${r.id}" aria-label="Удалить показание">${icon('trash')}</button></td></tr>`; }).join('')}</tbody></table></div>` : empty('Показаний пока нет', 'Добавьте первое показание. Расход рассчитается после следующего.', 'gauge', 'Внести показания', 'readings')}</div>`;
}
function intervalTable(meters) {
  const rows = meters.flatMap(m => intervals(state, m.id)).filter(r => r.from.slice(0, 4) === filter.year && (filter.month === 'all' || (r.period ? r.period.slice(5, 7) === filter.month : r.from.slice(5, 7) === filter.month))).sort((a, b) => b.to.localeCompare(a.to));
  return rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Квартира</th><th>Ресурс</th><th>Интервал</th><th>Расход</th><th>Оценка по тарифу</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${esc(property(r.propertyId)?.title)}</strong></td><td>${RESOURCES[r.type].label}</td><td>${shortDate(r.from)} — ${shortDate(r.to)}${!r.period ? '<span class="muted">Нестандартный интервал: без разбивки по месяцам</span>' : ''}</td><td><strong>${number(r.value)} ${RESOURCES[r.type].unit}</strong></td><td>${r.estimate === null ? 'Тариф не задан' : money(r.estimate)}</td></tr>`).join('')}</tbody></table></div>` : empty('Для расчёта нужны два показания', 'Первое показание задаёт начальную точку. Пустые значения не считаются нулём.', 'chart');
}
function expensesView() {
  const rows = state.expenses.filter(x => dateFilter(x.paid ? x.paidDate || x.date : x.date) && (filter.propertyId === 'all' || x.propertyId === filter.propertyId)).sort((a, b) => b.date.localeCompare(a.date));
  const f = finances(state, filter);
  return `<div class="metrics-strip"><div><p>Оплачено по аренде</p><strong>${money(f.expenses)}</strong></div><div><p>Оплачено за своё жильё</p><strong>${money(f.homeExpenses)}</strong></div><div><p>Ожидают оплаты</p><strong>${money(rows.filter(x => !x.paid).reduce((a, x) => a + x.amount, 0))}</strong></div></div><div class="panel table-panel">${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Дата / период</th><th>Квартира</th><th>Категория</th><th>Сумма</th><th>Плательщик</th><th>Статус</th><th></th></tr></thead><tbody>${rows.map(e => `<tr><td>${shortDate(e.date)}${e.period ? `<span class="muted">За ${shortPeriod(e.period)}</span>` : ''}</td><td><strong>${esc(property(e.propertyId)?.title)}</strong></td><td>${esc(e.category)}<span class="muted">${esc(e.note || '')}</span></td><td><strong>${money(e.amount)}</strong></td><td>${e.payer === 'owner' ? 'Собственник' : 'Арендатор напрямую'}</td><td><span class="badge ${e.paid ? 'green' : 'amber'}">${e.paid ? 'Оплачено' : 'Ожидается'}</span>${e.paid ? `<span class="muted">${shortDate(e.paidDate || e.date)}</span>` : ''}</td><td class="actions"><button class="icon-btn" data-action="expense" data-id="${e.id}" aria-label="Исправить расход">${icon('edit')}</button><button class="icon-btn" data-action="delete:expenses" data-id="${e.id}" aria-label="Удалить расход">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : empty('Здесь будут ваши расходы', 'Ремонт, коммунальные платежи и обслуживание. Добавляйте расходы по каждой квартире.', 'receipt', 'Добавить расход', 'expense')}</div><p class="accounting-note">Платежи арендатора напрямую и неоплаченные счета не уменьшают вашу фактическую прибыль. Возмещение оплаченного вами счёта добавляйте отдельным входящим платежом.</p>`;
}
function reportsView() {
  const f = finances(state, { ...filter, month: 'all' });
  const goal = state.settings.annualGoal, progress = goal ? f.rent / goal * 100 : 0;
  return `<div class="report-grid"><section class="panel"><div class="eyebrow">${filter.year} · ФАКТИЧЕСКИЙ РЕЗУЛЬТАТ</div><h2 style="font-size:16px;font-weight:500">Прибыль от аренды за год</h2><div class="report-total ${f.profit < 0 ? 'negative' : 'positive'}">${money(f.profit)}</div><div class="report-row"><span>Полученная аренда</span><strong>${money(f.rent)}</strong></div><div class="report-row"><span>Возмещения расходов</span><strong>+ ${money(f.reimbursements)}</strong></div><div class="report-row"><span>Оплаченные расходы по аренде</span><strong>− ${money(f.expenses)}</strong></div><div class="report-row total"><span>Прибыль от аренды</span><strong>${money(f.profit)}</strong></div><div class="inline-note">Расчёт по фактическим датам получения и оплаты. Залоги, будущие поступления и расходы собственного жилья в прибыль от аренды не входят.</div><div class="report-row"><span>Расходы собственного жилья</span><strong>${money(f.homeExpenses)}</strong></div><div class="report-row"><span>Остаток после расходов на свой дом</span><strong>${money(f.remaining)}</strong></div></section><section class="panel"><div class="section-head"><h2>Накопленная прибыль</h2><span class="muted">${filter.year}</span></div>${financeChart('profit')}<div style="margin-top:20px"><div class="report-row" style="border:0"><span>Цель по арендным поступлениям</span><strong>${money(goal)}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, Math.max(0, progress))}%"></div></div><span class="small muted" style="font-size:10px">${number(progress)}% цели · цель относится к поступлениям, не к прибыли</span></div></section></div><div class="section-head" style="margin-top:25px"><h2>Результат по квартирам</h2>${btn('Скачать Excel', 'export', 'download', 'small-btn')}</div><div class="panel table-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Квартира</th><th>Получено аренды</th><th>Возмещения</th><th>Расходы</th><th>Прибыль от аренды</th></tr></thead><tbody>${selectedProperty().map(p => { const x = finances(state, { year: filter.year, month: 'all', propertyId: p.id }); return `<tr><td><strong>${esc(p.title)}</strong><span class="muted">${p.use === 'home' ? 'Своё жильё' : 'Аренда'}</span></td><td>${p.use === 'home' ? '—' : money(x.rent)}</td><td>${p.use === 'home' ? '—' : money(x.reimbursements)}</td><td>${money(p.use === 'home' ? x.homeExpenses : x.expenses)}</td><td><strong class="${x.profit < 0 ? 'negative' : 'positive'}">${p.use === 'home' ? 'Не участвует' : money(x.profit)}</strong></td></tr>`; }).join('')}</tbody></table></div></div><div class="report-grid" style="margin-top:20px"><section class="panel"><div class="section-head"><h2>Расходы по категориям</h2></div>${expenseCategories()}</section><section class="panel"><div class="section-head"><h2>План и прогноз</h2></div>${forecast()}</section></div>`;
}
function expenseCategories() {
  const map = {};
  for (const e of state.expenses.filter(e => e.paid && e.payer === 'owner' && property(e.propertyId)?.use === 'rental' && (e.paidDate || e.date) <= today() && (e.paidDate || e.date).slice(0, 4) === filter.year && (filter.propertyId === 'all' || e.propertyId === filter.propertyId))) map[e.category] = (map[e.category] || 0) + e.amount;
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]), max = Math.max(1, ...rows.map(x => x[1]));
  return rows.length ? rows.map(([k, v]) => `<div style="margin-bottom:17px"><div style="display:flex;justify-content:space-between;gap:15px;font-size:11px;color:#7e9073"><span>${esc(k)}</span><strong style="font-weight:500">${money(v)}</strong></div><div class="progress-track" style="height:5px;margin-top:9px"><div class="progress-fill" style="width:${v / max * 100}%;background:#91aa7d"></div></div></div>`).join('') : empty('Расходов пока нет', 'Категории появятся после оплаты первого расхода.', 'receipt');
}
function forecast() {
  const period = monthOf(today()), nowYear = today().slice(0, 4);
  if (filter.year !== nowYear) return '<p class="accounting-note">Прогноз доступен для текущего года. За другие годы показан фактический результат.</p>';
  const futureCharges = charges(state, `${filter.year}-12`).filter(c => c.period > period && (filter.propertyId === 'all' || c.propertyId === filter.propertyId));
  const future = futureCharges.reduce((a, c) => a + Math.max(0, c.amount - c.paid), 0);
  const f = finances(state, { ...filter, month: 'all' });
  return `<div class="report-row"><span>Уже получено аренды</span><strong>${money(f.rent)}</strong></div><div class="report-row"><span>Начисления будущих месяцев</span><strong>${money(future)}</strong></div><div class="report-row total"><span>Ориентир по поступлениям</span><strong>${money(f.rent + future)}</strong></div><p class="accounting-note">Прогноз при действующих и запланированных договорах, без будущих расходов и без гарантии оплаты. Не включает ещё не полученные суммы текущего месяца и долги прошлых месяцев. Фактической прибылью не является.</p>`;
}
function settingsView() {
  return `<div class="settings-grid"><section class="panel settings-block"><h2>Параметры учёта</h2><p>Начало учёта начислений: <strong>${shortDate(state.settings.accountingStart)}</strong><br>Цель арендных поступлений: <strong>${money(state.settings.annualGoal)} в год</strong><br>Предупреждение о поверке: за ${state.settings.reminderDays} дней.</p>${btn('Изменить параметры', 'preferences', 'settings')}<p>Историю прошлых лет можно импортировать. Изменение начала учёта влияет на ожидаемые начисления; полученные платежи сохраняются.</p></section><section class="panel settings-block"><h2>Тарифы на ресурсы</h2><p>Задайте цену за м³ воды, м³ газа и кВт·ч электричества для оценки стоимости потребления. Тарифы сохраняются с датой начала действия.</p>${btn('Добавить тариф', 'tariff', 'plus')}${state.tariffs.length ? `<p>${state.tariffs.slice(-4).map(t => `${esc(property(t.propertyId)?.title)} · ${RESOURCES[t.type].label}: ${number(t.rate)} ₽ с ${shortDate(t.start)}`).join('<br>')}</p>` : '<p>Тарифы пока не заданы.</p>'}</section><section class="panel settings-block"><h2>Перенести историю из Excel</h2><p>Загрузите исходный XLSX или CSV. Сначала покажем найденные записи: показатели, расходы и поступления. Выберите, какие записи подтвердить.</p>${btn('Импортировать файл', 'import', 'upload')}<p>Денежные записи требуют отдельного подтверждения. Итоги и накопительные суммы не дублируются как платежи.</p></section><section class="panel settings-block"><h2>Экспорт и резервные копии</h2><p>Excel удобен для просмотра и анализа. Полная JSON-копия содержит все настройки, историю договоров и операций для восстановления.</p>${btn('Отчёт Excel', 'export', 'download')}${btn('Скачать копию', 'backup', 'download')}${btn('Восстановить', 'restore', 'upload')}<p>Восстановление заменит текущие данные только после подтверждения. Перед ним автоматически скачивается копия текущего состояния.</p></section></div><div class="info-banner" style="margin-top:22px">${icon('shield')}Ваши записи хранятся в приватной серверной базе. Код приложения в GitHub не содержит адресов, контактов арендаторов и финансовой истории.</div>`;
}
function empty(title, description, ic, button, action) { return `<div class="empty">${icon(ic)}<h3>${title}</h3><p>${description}</p>${button ? btn(button, action, 'plus') : ''}</div>`; }

let modalFocus;
function closeModal() { root.innerHTML = ''; document.body.style.overflow = ''; modalFocus?.focus?.(); }
function modal(title, subtitle, body, submit, { wide = false, submitLabel = 'Сохранить', footer = '' } = {}) {
  modalFocus = document.activeElement;
  root.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="icon-btn" data-action="close" aria-label="Закрыть">${icon('close')}</button></div><form id="active-form" style="display:contents"><div class="modal-body">${body}<div class="form-error" role="alert" id="form-error"></div></div><div class="modal-footer">${footer}<button class="btn" type="button" data-action="close">Отмена</button>${submit ? `<button class="btn primary" type="submit">${icon('check')}${submitLabel}</button>` : ''}</div></form></section></div>`;
  document.body.style.overflow = 'hidden';
  root.querySelector('input,select,textarea,button')?.focus();
  if (submit) document.querySelector('#active-form').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget, error = document.querySelector('#form-error'); error.textContent = '';
    try { await submit(new FormData(form), form); closeModal(); } catch (err) { error.textContent = err.message; error.scrollIntoView({ block: 'nearest' }); }
  });
}
const input = (name, label, value = '', type = 'text', attrs = '', full = false, hint = '') => `<div class="form-field ${full ? 'full' : ''}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</div>`;
const select = (name, label, opts, full = false, hint = '') => `<div class="form-field ${full ? 'full' : ''}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${opts}</select>${hint ? `<small>${hint}</small>` : ''}</div>`;
const note = (value = '') => `<div class="form-field full"><label for="f-note">Комментарий</label><textarea id="f-note" name="note" maxlength="1000">${esc(value)}</textarea></div>`;
const amount = (name, label, value, full = false) => input(name, label, value, 'number', 'step="0.01" min="0.01" inputmode="decimal" required', full);
const getNumber = (fd, key) => Number(String(fd.get(key) ?? '').replace(/\s/g, '').replace(',', '.'));
function paymentForm(id, period, editId) {
  const old = state.payments.find(p => p.id === editId);
  const rentals = state.properties.filter(p => p.use === 'rental');
  const pId = old?.propertyId || id || (filter.propertyId !== 'all' && property(filter.propertyId)?.use === 'rental' ? filter.propertyId : rentals[0]?.id);
  const p = property(pId); if (!p) return toast('Сначала добавьте сдаваемую квартиру.');
  const per = old?.period || period || monthOf(today());
  const defaultContract = state.contracts.find(c => c.id === old?.contractId) || contractForMonth(state, pId, per);
  const debt = charges(state, per).find(c => c.propertyId === pId && c.period === per)?.debt;
  const body = `<div class="form-grid">${select('propertyId', 'Квартира', options(rentals.map(p => [p.id, p.title]), pId))}${select('kind', 'Вид поступления', options([['rent', 'Арендная плата'], ['reimbursement', 'Возмещение расходов'], ['deposit_in', 'Получение залога'], ['deposit_out', 'Возврат залога']], old?.kind || 'rent'))}${select('contractId', 'Договор / арендатор', contractOptions(pId, old ? old.contractId || '' : defaultContract?.id), true)}${input('date', 'Дата получения', old?.date || today(), 'date', 'required')}${select('datePrecision', 'Точность даты получения', options([['day', 'Точный день известен'], ['month', 'Известен только месяц']], old?.datePrecision || 'day'), false, 'Если известен только месяц, выбранное число используется технически. В истории будет показан только месяц.')}${amount('amount', 'Сумма, ₽', old?.amount ?? (debt || defaultContract?.rent || ''))}${input('period', 'За какой месяц', per, 'month', 'required')}${input('endPeriod', 'По месяц включительно', per, 'month', 'required', false, 'Для нескольких месяцев сумма распределится по начислениям. При сумме 0 ₽ в каждом выбранном месяце сохранится ноль.')}${select('method', 'Способ получения', options(['Перевод', 'Наличные', 'Другое'].map(x => [x, x]), old?.method || 'Перевод'), true)}${note(old?.note)}</div><div class="inline-note">0 ₽ — отметка, что аренда не поступила. Если жильцы съехали, завершите договор в карточке квартиры, чтобы прекратить начисления. Залог хранится отдельно от дохода.</div>`;
  modal(old ? 'Исправить платёж' : 'Получена аренда', 'Укажите полученную сумму или 0 ₽, если поступления не было.', body, async fd => {
    const item = { id: old?.id || uid(), propertyId: fd.get('propertyId'), contractId: fd.get('contractId'), kind: fd.get('kind'), amount: getNumber(fd, 'amount'), date: fd.get('datePrecision') === 'month' ? monthOf(fd.get('date')) + '-01' : fd.get('date'), datePrecision: fd.get('datePrecision'), period: fd.get('period'), method: fd.get('method'), note: fd.get('note') };
    const end = fd.get('endPeriod');
    if (!String(fd.get('amount') ?? '').trim() || !Number.isFinite(item.amount) || item.amount < 0 || item.amount > 1e10 || (item.amount === 0 && item.kind !== 'rent')) throw Error('Укажите сумму: для аренды допустим 0 ₽, для остальных поступлений — больше нуля.');
    if (item.kind === 'rent' && item.amount === 0) item.method = '';
    if (item.kind !== 'rent') { item.period = ''; item.contractId = ''; }
    if (item.kind === 'deposit_out') {
      const balance = state.payments.filter(x => x.propertyId === item.propertyId && x.id !== old?.id && x.date <= item.date).reduce((a, x) => a + (x.kind === 'deposit_in' ? x.amount : x.kind === 'deposit_out' ? -x.amount : 0), 0);
      if (item.amount > balance) throw Error('Возврат превышает полученный остаток залога. Сначала проверьте историю залогов.');
    }
    if (item.kind === 'rent' && !(item.amount === 0 && !item.contractId) && !state.contracts.some(c => c.id === item.contractId && c.propertyId === item.propertyId)) throw Error('Выберите договор. Без договора можно записать только 0 ₽.');
    const periods = item.kind === 'rent' ? monthRange(item.period, end) : [''];
    if (!periods.length || periods.length > 24) throw Error('Выберите последовательный период не более 24 месяцев.');
    await mutate(s => {
      if (old) s.payments = s.payments.filter(x => x.id !== old.id);
      let remainder = Math.round(item.amount * 100);
      for (let i = 0; i < periods.length; i++) {
        const m = periods[i];
        const c = s.contracts.find(c => c.id === item.contractId);
        if (item.kind === 'rent' && c && (m < monthOf(c.start) || (c.end && m > monthOf(c.end)))) throw Error('Период оплаты выходит за даты выбранного договора.');
        const remainingDue = c ? Math.max(0, Math.round(((c.overrides?.[m] ?? c.rent) - paidFor(s, c.id, m, item.date)) * 100)) : remainder;
        const part = i === periods.length - 1 ? remainder : Math.min(remainder, remainingDue);
        if (part > 0 || item.amount === 0) s.payments.push({ ...item, id: i === 0 ? item.id : uid(), period: m, amount: part / 100 });
        remainder -= part;
      }
    }, old ? 'Платёж исправлен' : 'Платёж сохранён');
  }, { submitLabel: old ? 'Сохранить изменения' : 'Записать платёж' });
  const refreshPayment = () => {
    const pid = root.querySelector('[name="propertyId"]').value;
    const per = root.querySelector('[name="period"]').value;
    const c = contractForMonth(state, pid, per);
    root.querySelector('[name="contractId"]').innerHTML = contractOptions(pid, c?.id);
    if (!old) root.querySelector('[name="amount"]').value = c ? Math.max(0, c.rent - paidFor(state, c.id, per)) || c.rent : '';
    updateKind();
  };
  root.querySelector('[name="propertyId"]').addEventListener('change', refreshPayment);
  root.querySelector('[name="period"]').addEventListener('change', () => { root.querySelector('[name="endPeriod"]').value = root.querySelector('[name="period"]').value; refreshPayment(); });
  const updateKind = () => {
    const isRent = root.querySelector('[name="kind"]').value === 'rent', amountInput = root.querySelector('[name="amount"]');
    const zeroRent = isRent && amountInput.value.trim() !== '' && Number(amountInput.value) === 0;
    amountInput.min = isRent ? '0' : '0.01';
    for (const n of ['period', 'endPeriod', 'contractId']) { const el = root.querySelector(`[name="${n}"]`); el.required = isRent && (n !== 'contractId' || !zeroRent); el.closest('.form-field').style.display = isRent ? '' : 'none'; }
    root.querySelector('label[for="f-date"]').textContent = zeroRent ? 'Дата записи' : 'Дата получения';
    root.querySelector('[name="method"]').closest('.form-field').style.display = zeroRent ? 'none' : '';
  };
  for (const event of ['input', 'change']) root.querySelector('[name="amount"]').addEventListener(event, updateKind);
  root.querySelector('[name="kind"]').addEventListener('change', updateKind); updateKind();
}
function contractOptions(pid, chosen = '') { const cs = state.contracts.filter(c => c.propertyId === pid).sort((a, b) => b.start.localeCompare(a.start)); return options([['', 'Без договора / нет жильцов (0 ₽)'], ...cs.map(c => [c.id, `${c.tenant || 'Арендатор не указан'} · с ${shortDate(c.start)}${c.end ? ' до ' + shortDate(c.end) : ''}`])], chosen); }
function expenseForm(id) {
  const old = state.expenses.find(e => e.id === id), pid = old?.propertyId || (filter.propertyId !== 'all' ? filter.propertyId : state.properties[0].id);
  modal(old ? 'Исправить расход' : 'Добавить расход', 'Укажите квартиру и кто оплачивает этот расход.', `<div class="form-grid">${select('propertyId', 'Квартира', propertyOptions(pid))}${select('category', 'Категория', options(CATEGORIES.map(c => [c, c]), old?.category || 'ЖКХ'))}${amount('amount', 'Сумма, ₽', old?.amount || '')}${input('date', 'Дата счёта / расхода', old?.date || today(), 'date', 'required')}${input('period', 'За какой месяц, необязательно', old?.period || '', 'month')}${select('payer', 'Кто платит', options([['owner', 'Собственник'], ['tenant', 'Арендатор напрямую']], old?.payer || 'owner'))}${select('paid', 'Статус', options([['true', 'Уже оплачен'], ['false', 'Ожидает оплаты']], String(old?.paid ?? true)))}${input('paidDate', 'Дата фактической оплаты', old?.paidDate || today(), 'date', 'required')}${note(old?.note)}</div><div class="inline-note">Своё жильё учитывается отдельно. Если арендатор вернул вам деньги за счёт, добавьте входящий платёж «Возмещение расходов».</div>`, async fd => {
    const paid = fd.get('paid') === 'true';
    const item = { id: old?.id || uid(), propertyId: fd.get('propertyId'), category: fd.get('category'), amount: getNumber(fd, 'amount'), date: fd.get('date'), period: fd.get('period'), payer: fd.get('payer'), paid, paidDate: paid ? fd.get('paidDate') : '', note: fd.get('note') };
    await mutate(s => { if (old) s.expenses[s.expenses.findIndex(x => x.id === old.id)] = item; else s.expenses.push(item); }, 'Расход сохранён');
  });
  const update = () => { const show = root.querySelector('[name="paid"]').value === 'true', el = root.querySelector('[name="paidDate"]'); el.required = show; el.closest('.form-field').style.display = show ? '' : 'none'; };
  root.querySelector('[name="paid"]').addEventListener('change', update); update();
}
function readingsForm(propertyId, selectedDate) {
  const ps = propertyId ? state.properties.filter(p => p.id === propertyId) : state.properties;
  const date = selectedDate || monthOf(today()) + '-01';
  modal('Внести показания', 'Пустые поля можно оставить. Сохранятся только введённые значения.', `${input('date', 'Дата снятия показаний', date, 'date', `required max="${today()}"`, true)}<div style="height:17px"></div>${ps.map(p => `<div class="reading-group"><h3>${esc(p.title)}</h3><div class="reading-inputs">${Object.keys(RESOURCES).map(type => { const m = state.meters.find(m => m.propertyId === p.id && m.type === type && !m.retired); if (!m) return ''; const last = state.readings.filter(r => r.meterId === m.id).sort((a, b) => b.date.localeCompare(a.date))[0]; return input(m.id, `${RESOURCES[type].label}, ${RESOURCES[type].unit}`, '', 'number', 'min="0" step="0.001" inputmode="decimal"', false, last ? `Последнее: ${number(last.value)}<br>${shortDate(last.date)}` : 'Первое задаст начало учёта'); }).join('')}</div></div>`).join('')}`, async fd => {
    const date = fd.get('date'); if (date > today()) throw Error('Фактические показания нельзя внести будущим числом.');
    let count = 0;
    await mutate(s => {
      for (const m of s.meters.filter(m => !m.retired && ps.some(p => p.id === m.propertyId))) {
        const raw = fd.get(m.id); if (raw === null || raw === '') continue;
        const value = getNumber(fd, m.id), old = s.readings.find(r => r.meterId === m.id && r.date === date);
        if (old) throw Error(`${property(m.propertyId).title}, ${RESOURCES[m.type].label}: на эту дату показание уже есть. Исправьте его в истории.`);
        s.readings.push({ id: uid(), meterId: m.id, date, value, note: '' }); count++;
      }
      if (!count) throw Error('Введите хотя бы одно показание.');
    }, `Сохранено показаний: ${count || 'все введённые'}`);
  }, { wide: true, submitLabel: 'Сохранить показания' });
}
function editReadingForm(id) {
  const old = state.readings.find(r => r.id === id), m = state.meters.find(m => m.id === old.meterId);
  modal('Исправить показание', `${esc(property(m.propertyId).title)} · ${RESOURCES[m.type].label}`, `<div class="form-grid">${input('date', 'Дата снятия', old.date, 'date', `required max="${today()}"`)}${input('value', `Показание, ${RESOURCES[m.type].unit}`, old.value, 'number', 'required min="0" step="0.001" inputmode="decimal"')}${note(old.note)}</div>`, async fd => {
    await mutate(s => { Object.assign(s.readings.find(r => r.id === id), { date: fd.get('date'), value: getNumber(fd, 'value'), note: fd.get('note') }); }, 'Показание исправлено. Расход пересчитан.');
  });
}
function meterForm(id) {
  const m = state.meters.find(m => m.id === id);
  modal('Настройки счётчика', `${esc(property(m.propertyId).title)} · ${RESOURCES[m.type].label}`, `<div class="form-grid">${input('serial', 'Номер прибора', m.serial, 'text', 'maxlength="100"', true)}${input('due', 'Следующая поверка', m.due || '', 'date')}${input('verified', 'Последняя выполненная поверка', m.verified || '', 'date', `max="${today()}"`)}</div><div class="inline-note">После выполненной поверки укажите новый срок вручную. Запись о расходе на поверку его не меняет.</div>${!m.retired ? btn('Заменить прибор', 'replace-meter:' + id, 'refresh', 'small-btn') : '<p class="small muted">Прибор заменён. История сохранена.</p>'}`, async fd => {
    await mutate(s => { Object.assign(s.meters.find(x => x.id === id), { serial: fd.get('serial'), due: fd.get('due'), verified: fd.get('verified') }); }, 'Настройки счётчика сохранены');
  });
}
function replaceMeterForm(id) {
  const m = state.meters.find(m => m.id === id);
  modal('Замена счётчика', 'Старый прибор и его история сохранятся. Для нового начнётся отдельный учёт.', `<div class="form-grid">${input('date', 'Дата замены', today(), 'date', `required max="${today()}"`)}${input('last', 'Последнее показание старого', '', 'number', 'min="0" step="0.001" inputmode="decimal"', false, 'Необязательно; если уже внесено, оставьте пустым.')}${input('value', 'Начальное показание нового', 0, 'number', 'required min="0" step="0.001" inputmode="decimal"')}${input('serial', 'Номер нового прибора')}${input('due', 'Следующая поверка нового', '', 'date', '', true)}</div>`, async fd => {
    await mutate(s => {
      const old = s.meters.find(x => x.id === id); old.retired = true;
      const date = fd.get('date');
      if (s.readings.some(r => r.meterId === id && r.date > date)) throw Error('После даты замены есть показания старого прибора. Сначала проверьте историю.');
      if (fd.get('last') !== '') {
        const exists = s.readings.find(r => r.meterId === id && r.date === date);
        if (exists) throw Error('На дату замены уже есть показание старого прибора. Оставьте поле последнего показания пустым.');
        s.readings.push({ id: uid(), meterId: id, date, value: getNumber(fd, 'last'), note: 'Последнее перед заменой' });
      }
      const newId = uid(); s.meters.push({ id: newId, propertyId: m.propertyId, type: m.type, serial: fd.get('serial'), due: fd.get('due'), retired: false });
      s.readings.push({ id: uid(), meterId: newId, date, value: getNumber(fd, 'value'), note: 'Начальное показание нового прибора' });
    }, 'Прибор заменён. История сохранена.');
  });
}
function propertyForm(id) {
  const p = property(id);
  modal('Настройки квартиры', 'Название используется в карточках и отчётах.', `<div class="form-grid">${input('title', 'Название', p.title, 'text', 'required maxlength="80"', true)}${input('address', 'Полный адрес', p.address, 'text', 'maxlength="300"', true)}${select('use', 'Назначение', options([['rental', 'Сдаётся в аренду'], ['home', 'Живём сами']], p.use))}${select('color', 'Цвет карточки', options([['mint', 'Шалфей'], ['sand', 'Песочный'], ['lilac', 'Лавандовый']], p.color))}</div>`, async fd => {
    if (fd.get('use') !== p.use && state.payments.some(x => x.propertyId === p.id && x.kind === 'rent')) throw Error('У квартиры есть история аренды. Для смены назначения с сохранением исторических отчётов понадобится отдельный период использования; в первой версии это изменение заблокировано.');
    await mutate(s => Object.assign(s.properties.find(x => x.id === id), { title: fd.get('title').trim(), address: fd.get('address').trim(), use: fd.get('use'), color: fd.get('color') }), 'Квартира обновлена');
  });
}
function contractForm(pid) {
  const p = property(pid), c = activeContract(state, pid) || state.contracts.filter(c => c.propertyId === pid && !c.historyOnly && c.start > today()).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (p.use !== 'rental') return toast('Для собственного жилья договор аренды не нужен.');
  modal('Условия аренды', esc(p.title) + ' · сохраняем историю ставок и арендаторов', `<div class="form-grid">${input('tenant', 'Арендатор', c?.tenant || '', 'text', 'maxlength="150"', true)}${input('phone', 'Телефон, необязательно', c?.phone || '', 'tel')}${amount('rent', 'Аренда в месяц, ₽', c?.rent || 35000)}${input('dueDay', 'День оплаты', c?.dueDay || 21, 'number', 'required min="1" max="31" step="1" inputmode="numeric"')}${input('deposit', 'Залог по договору, ₽', c?.deposit || 0, 'number', 'required min="0" step="0.01" inputmode="decimal"')}${input('start', 'Дата начала условий', c?.start || today(), 'date', 'required')}${input('end', 'Дата окончания, необязательно', c?.end || '', 'date')}${input('firstDueDate', 'Дата первого платежа, необязательно', c?.firstDueDate || '', 'date', '', true, 'Если первый платёж нужен в другой день. Следующие месяцы используют обычный день оплаты.')}${amount('firstAmount', 'Первое начисление, ₽', c?.rent || 35000)}${c ? amount('lastAmount', 'Последнее начисление старых условий, ₽', c.rent) : ''}${note(c?.note)}</div>${c ? `<label class="check-line"><input type="checkbox" name="newVersion">Новые условия / новый арендатор: сохранить прежний договор в истории</label>` : ''}<div class="inline-note">При новых условиях укажите дату их начала. Для неполного месяца вручную подтвердите первое начисление, а также последнее начисление прежних условий. Для изменения с 1-го числа последнюю сумму старого договора оставьте полной.</div>`, async fd => {
    const item = { id: c?.id || uid(), propertyId: pid, tenant: fd.get('tenant').trim(), phone: fd.get('phone'), rent: getNumber(fd, 'rent'), dueDay: getNumber(fd, 'dueDay'), firstDueDate: fd.get('firstDueDate'), deposit: getNumber(fd, 'deposit'), start: fd.get('start'), end: fd.get('end'), note: fd.get('note'), overrides: { ...c?.overrides } };
    const newVersion = fd.get('newVersion') === 'on';
    if (c && !newVersion && state.payments.some(x => x.contractId === c.id) && (item.rent !== c.rent || item.dueDay !== c.dueDay || item.start !== c.start)) throw Error('У договора уже есть платежи. Отметьте «Новые условия», чтобы сохранить историю.');
    await mutate(s => {
      if (c && newVersion) {
        if (item.start <= c.start) throw Error('Новые условия должны начаться позже предыдущих.');
        const end = new Date(Date.parse(item.start) - 86400000).toISOString().slice(0, 10);
        const old = s.contracts.find(x => x.id === c.id); old.end = end;
        old.overrides = { ...old.overrides, [monthOf(end)]: getNumber(fd, 'lastAmount') };
        item.id = uid(); item.overrides = {};
      }
      item.overrides[monthOf(item.start)] = getNumber(fd, 'firstAmount');
      if (c && !newVersion) s.contracts[s.contracts.findIndex(x => x.id === c.id)] = item; else s.contracts.push(item);
    }, 'Условия аренды сохранены');
  });
  const checkbox = root.querySelector('[name="newVersion"]');
  checkbox?.addEventListener('change', () => { root.querySelector('[name="start"]').value = checkbox.checked ? addMonths(monthOf(today())) + '-01' : c.start; root.querySelector('[name="firstDueDate"]').value = checkbox.checked ? '' : c.firstDueDate || ''; });
  for (const key of ['firstAmount', 'lastAmount']) { const el = root.querySelector(`[name="${key}"]`); if (el) el.min = '0'; }
  let previousRent = String(c?.rent || 35000);
  root.querySelector('[name="rent"]').addEventListener('input', e => { const first = root.querySelector('[name="firstAmount"]'); if (first.value === previousRent) first.value = e.target.value; previousRent = e.target.value; });
}
function endContractForm(id) {
  const c = state.contracts.find(x => x.id === id);
  modal('Завершить договор', 'Платежи и данные арендатора сохранятся в истории.', `<div class="form-grid">${input('end', 'Последний день действия', today(), 'date', 'required')}${amount('lastAmount', 'Согласованная плата за последний месяц, ₽', c.rent)}</div>`, async fd => { await mutate(s => { const x = s.contracts.find(x => x.id === id); x.end = fd.get('end'); x.overrides = { ...x.overrides, [monthOf(x.end)]: getNumber(fd, 'lastAmount') }; }, 'Договор завершён'); });
  root.querySelector('[name="lastAmount"]').min = '0';
}
function chargeForm(id, period) {
  const c = state.contracts.find(x => x.id === id);
  modal('Согласованное начисление', `${esc(property(c.propertyId).title)} · ${shortPeriod(period)}`, `${input('amount', 'Сумма за этот месяц, ₽', c.overrides?.[period] ?? c.rent, 'number', 'required min="0" step="0.01" inputmode="decimal"', true)}<div class="inline-note">Используйте для неполного месяца или отдельной договорённости. Ставка других месяцев и полученные платежи сохранятся.</div>`, async fd => { await mutate(s => { const x = s.contracts.find(x => x.id === id); x.overrides = { ...x.overrides, [period]: getNumber(fd, 'amount') }; }, 'Начисление изменено'); });
}
function preferencesForm() {
  modal('Параметры учёта', 'Начисления формируются начиная с выбранной даты.', `<div class="form-grid">${input('accountingStart', 'Начало учёта', state.settings.accountingStart, 'date', 'required')}${input('annualGoal', 'Годовая цель по арендным поступлениям, ₽', state.settings.annualGoal, 'number', 'min="0" required step="1" inputmode="numeric"')}${select('reminderDays', 'Напоминать о поверке', options([[7, 'За 7 дней'], [30, 'За 30 дней'], [60, 'За 60 дней'], [90, 'За 90 дней']], state.settings.reminderDays), true)}</div><div class="inline-note">Начало учёта ограничивает начисления и расчёт долгов. Для достоверной задолженности сначала перенесите платежи за весь выбранный период.</div>`, async fd => { await mutate(s => Object.assign(s.settings, { accountingStart: fd.get('accountingStart'), annualGoal: getNumber(fd, 'annualGoal'), reminderDays: getNumber(fd, 'reminderDays') }), 'Настройки сохранены'); });
}
function tariffForm() {
  modal('Добавить тариф', 'Оценка по тарифу не является оплаченным расходом.', `<div class="form-grid">${select('propertyId', 'Квартира', propertyOptions(filter.propertyId === 'all' ? state.properties[0].id : filter.propertyId))}${select('type', 'Ресурс', options(Object.entries(RESOURCES).map(([k, v]) => [k, `${v.label}, ₽/${v.unit}`]), 'water'))}${input('rate', 'Стоимость единицы, ₽', '', 'number', 'min="0" step="0.0001" required inputmode="decimal"')}${input('start', 'Действует с', monthOf(today()) + '-01', 'date', 'required')}</div>`, async fd => { await mutate(s => { const row = { id: uid(), propertyId: fd.get('propertyId'), type: fd.get('type'), rate: getNumber(fd, 'rate'), start: fd.get('start') }; const old = s.tariffs.find(t => t.propertyId === row.propertyId && t.type === row.type && t.start === row.start); if (old) Object.assign(old, row); else s.tariffs.push(row); }, 'Тариф сохранён'); });
}

function download(blob, filename) { const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function backup() { download(new Blob([JSON.stringify({ application: 'moi-kvartiry', exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' }), `moi-kvartiry-${today()}${demo ? '-demo' : ''}.json`); }
function restoreForm() {
  modal('Восстановить резервную копию', 'Текущие данные будут заменены. Их копия скачается перед восстановлением.', `<label class="file-drop">${icon('upload')}Выберите JSON-копию приложения<input type="file" name="file" accept="application/json,.json" required></label><label class="check-line"><input type="checkbox" name="confirm" required>Подтверждаю замену всех текущих записей данными из файла</label>`, async fd => {
    const file = fd.get('file'); if (file.size > 3000000) throw Error('Копия слишком большая, максимально 3 МБ.');
    const parsed = JSON.parse(await file.text()); if (parsed.application !== 'moi-kvartiry') throw Error('Этот файл не является копией приложения «Мои квартиры».');
    const restored = validateState(parsed.state); backup(); await mutate(s => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, restored); }, 'Резервная копия восстановлена');
  }, { submitLabel: 'Восстановить' });
}
function importForm() {
  selectedImport = [];
  modal('Перенести историю из Excel', 'Поддерживается исходная книга по годам 2022–2026 и CSV приложения. Сначала — предварительный просмотр.', `<label class="file-drop">${icon('upload')}Выберите XLSX или CSV<input type="file" name="file" accept=".xlsx,.csv" required></label><div class="inline-note">Аренда «50» и «35» из старой книги будет переведена в 50 000 ₽ и 35 000 ₽. Прочие расходы уже указаны в рублях. Импорт не меняет исходный файл.</div>`, async fd => {
    const file = fd.get('file');
    const parsed = await readWorkbook(file, state);
    // The form wrapper closes after completion; schedule the next dialog after it.
    setTimeout(() => importPreview(parsed), 0);
  }, { submitLabel: 'Проверить файл' });
}
function importPreview(parsed) {
  selectedImport = parsed.candidates;
  const counts = { reading: 'Показание', payment: 'Поступление', expense: 'Расход' };
  modal('Проверьте найденные записи', `Найдено: ${selectedImport.length}. Пропущено уже существующих: ${parsed.duplicates}. Денежные записи по умолчанию не выбраны.`, `${parsed.warnings.length ? `<div class="inline-note">${parsed.warnings.map(esc).join('<br><br>')}</div>` : ''}<div class="radio-row"><button type="button" class="text-button" data-action="import-select-readings">Выбрать показания</button><button type="button" class="text-button" data-action="import-select-all">Выбрать всё</button><button type="button" class="text-button" data-action="import-select-none">Снять выбор</button></div><div class="import-scroll">${selectedImport.map((r, i) => `<label class="import-row"><input class="checkbox" type="checkbox" name="row" value="${i}" ${r.selected ? 'checked' : ''}><span><strong>${counts[r.kind]} · ${esc(r.label)}</strong><p>${esc(r.source)} · ${shortDate(r.payload.date)}${r.payload.date > today() ? ' · будущая запись' : ''}</p></span><strong>${r.kind === 'reading' ? number(r.payload.value) : money(r.payload.amount)}</strong></label>`).join('') || '<p class="accounting-note">Новых распознанных записей нет.</p>'}</div><label class="check-line"><input type="checkbox" name="confirmMoney">Подтверждаю фактическое получение выбранных поступлений и проверил(а) их даты</label><label class="check-line"><input type="checkbox" name="paidExpenses">Выбранные расходы уже оплачены в указанные даты. Без этой отметки они будут ожидаемыми</label><div class="inline-note">Поступления импортируются отдельно от начислений. Для прошлых периодов создаётся техническая история с отдельно отмеченными неизвестными начислениями. Она не восстанавливает пропущенные договоры и не определяет старые долги.</div>`, async fd => {
    const indices = fd.getAll('row').map(Number), rows = indices.map(i => selectedImport[i]);
    if (!rows.length) throw Error('Выберите хотя бы одну запись.');
    if (rows.some(r => r.kind === 'payment') && fd.get('confirmMoney') !== 'on') throw Error('Подтвердите фактическое получение выбранных денежных поступлений.');
    await mutate(s => {
      const payments = rows.filter(r => r.kind === 'payment').sort((a, b) => a.payload.period.localeCompare(b.payload.period));
      for (const row of rows.filter(r => r.kind !== 'payment')) {
        const x = { ...row.payload };
        if (row.kind === 'reading') { if (x.date > today()) throw Error('Исключите будущие показания: ' + shortDate(x.date)); s.readings.push(x); }
        if (row.kind === 'expense') { x.paid = fd.get('paidExpenses') === 'on'; x.paidDate = x.paid ? x.date : ''; s.expenses.push(x); }
        s.importKeys.push(row.key);
      }
      for (const row of payments) {
        const x = { ...row.payload };
        if (x.kind === 'rent' && x.amount > 0) {
          let c = contractForMonth(s, x.propertyId, x.period);
          if (!c) {
            const after = s.contracts.filter(c => c.propertyId === x.propertyId && c.start > x.period + '-01').sort((a, b) => a.start.localeCompare(b.start))[0];
            const before = s.contracts.filter(c => c.propertyId === x.propertyId && c.end && c.end < x.period + '-01').sort((a, b) => b.end.localeCompare(a.end))[0];
            const start = before ? new Date(Date.parse(before.end) + 86400000).toISOString().slice(0, 10) : x.period + '-01';
            const end = after ? new Date(Date.parse(after.start) - 86400000).toISOString().slice(0, 10) : dueDate(x.period, 31);
            c = { id: uid(), propertyId: x.propertyId, tenant: 'История из Excel — уточните договор', phone: '', start, end, rent: 0, dueDay: 1, deposit: 0, overrides: {}, historyOnly: true, note: 'Техническая запись для поступлений из Excel. Начисления и возможные старые долги неизвестны.' };
            s.contracts.push(c);
          }
          x.contractId = c.id;
          // Cash receipts are not evidence of the original charge; keep it unknown.
        } else x.contractId = '';
        s.payments.push(x); s.importKeys.push(row.key);
      }
    }, `Перенесено записей: ${rows.length}`);
  }, { wide: true, submitLabel: 'Импортировать выбранное' });
}
function deleteForm(collection, id) {
  const label = { readings: 'показание', payments: 'платёж', expenses: 'расход' }[collection];
  modal(`Удалить ${label}?`, 'Связанные показатели и отчёты будут пересчитаны.', '<p class="accounting-note">Удаляйте только ошибочные записи. Для корректировки суммы или даты можно воспользоваться редактированием.</p>', async () => { await mutate(s => { s[collection] = s[collection].filter(x => x.id !== id); }, 'Запись удалена'); }, { submitLabel: 'Удалить' });
}
function metricDetails(kind) {
  const yearOnly = kind === 'year';
  const matches = x => x.date <= today() && x.date.slice(0, 4) === filter.year && (yearOnly || filter.month === 'all' || x.date.slice(5, 7) === filter.month) && (filter.propertyId === 'all' || x.propertyId === filter.propertyId) && property(x.propertyId)?.use === 'rental';
  const ps = kind === 'expenses' ? [] : state.payments.filter(p => ['rent', 'reimbursement'].includes(p.kind) && (kind !== 'rent' || p.kind === 'rent') && matches(p));
  const es = kind === 'rent' ? [] : state.expenses.filter(e => e.paid && e.payer === 'owner' && matches({ ...e, date: e.paidDate || e.date }));
  const rows = [...ps.map(p => ({ date: p.date, datePrecision: p.datePrecision, propertyId: p.propertyId, label: p.kind === 'rent' ? 'Арендная плата' : 'Возмещение расходов', amount: p.amount })), ...es.map(e => ({ date: e.paidDate || e.date, propertyId: e.propertyId, label: e.category, amount: -e.amount }))].sort((a, b) => b.date.localeCompare(a.date));
  modal('Из чего складывается показатель', `${yearOnly ? filter.year + ' год' : filter.month === 'all' ? filter.year : shortPeriod(filter.year + '-' + filter.month)} · только фактические операции`, rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Дата</th><th>Квартира</th><th>Операция</th><th>Сумма</th></tr></thead><tbody>${rows.map(r => `<tr><td>${paymentDate(r)}</td><td>${esc(property(r.propertyId)?.title)}</td><td>${esc(r.label)}</td><td><strong class="${r.amount < 0 ? 'negative' : 'positive'}">${money(r.amount)}</strong></td></tr>`).join('')}</tbody></table></div>` : empty('Операций за период нет', 'После добавления платежей и расходов здесь будет подробный расчёт.', 'wallet'), null, { wide: true });
}
async function handleAction(action, el) {
  const id = el?.dataset.id, period = el?.dataset.period;
  if (action === 'close') return closeModal();
  if (action === 'retry') return boot();
  if (action === 'menu') { sidebarOpen = !sidebarOpen; return render(); }
  if (action === 'payment') return paymentForm(id, period);
  if (action === 'edit-payment') return paymentForm(null, null, id);
  if (action === 'expense') return expenseForm(id);
  if (action === 'readings') return readingsForm(id, el?.dataset.date);
  if (action.startsWith('sheet-year:')) { filter.year = action.slice(11); render(); return; }
  if (action === 'sheet-payments') {
    const records = state.payments.filter(p => p.propertyId === id && p.kind === 'rent' && p.period === period).sort((a, b) => a.date.localeCompare(b.date));
    modal('Платежи за месяц', `${esc(property(id)?.title)} · ${shortPeriod(period)}`, `<div class="table-wrap"><table class="data-table"><thead><tr><th>Дата</th><th>Сумма</th><th></th></tr></thead><tbody>${records.map(p => `<tr><td>${paymentDate(p)}</td><td>${money(p.amount)}</td><td><button class="icon-btn" data-action="edit-payment" data-id="${esc(p.id)}" aria-label="Исправить платёж">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div><div style="margin-top:15px"><button type="button" class="btn primary" data-action="payment" data-id="${esc(id)}" data-period="${period}">${icon('plus')}Получена ещё оплата</button></div>`, null);
    return;
  }
  if (action === 'edit-reading') return editReadingForm(id);
  if (action === 'meter') return meterForm(id);
  if (action === 'property') return propertyForm(id);
  if (action === 'charge') return chargeForm(id, period);
  if (action.startsWith('contract:')) return contractForm(action.slice(9));
  if (action.startsWith('end-contract:')) return endContractForm(action.slice(13));
  if (action.startsWith('replace-meter:')) return replaceMeterForm(action.slice(14));
  if (action.startsWith('delete:')) return deleteForm(action.slice(7), id);
  if (action.startsWith('metric:')) return metricDetails(action.slice(7));
  if (action === 'preferences') return preferencesForm();
  if (action === 'tariff') return tariffForm();
  if (action === 'backup') { backup(); return toast('Резервная копия скачана'); }
  if (action === 'restore') return restoreForm();
  if (action === 'import') return importForm();
  if (action === 'export') {
    modal('Скачать отчёт', 'Excel содержит все операции и годовую сводку. Для полного восстановления используйте JSON-копию.', `<div class="inline-note">Отчёт за ${filter.year} год; подробная история операций экспортируется за все годы.</div>${btn('Скачать CSV операций', 'export-csv', 'download')}`, async () => { download(await exportWorkbook(state, filter.year), `moi-kvartiry-${filter.year}${demo ? '-demo' : ''}.xlsx`); }, { submitLabel: 'Скачать Excel' });
    return;
  }
  if (action === 'export-csv') { download(exportCSV(state), `moi-kvartiry-${today()}.csv`); return toast('CSV скачан. Для восстановления настроек используйте JSON.'); }
  if (action.startsWith('import-select-')) { const mode = action.slice(14); root.querySelectorAll('[name="row"]').forEach(x => { x.checked = mode === 'all' || mode === 'readings' && selectedImport[Number(x.value)].kind === 'reading' && selectedImport[Number(x.value)].payload.date <= today(); }); return; }
  if (action === 'demo') {
    if (demo) { state = realState; realState = null; demo = false; } else { realState = state; state = demoState(); demo = true; }
    closeModal(); render(); return;
  }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-view],[data-meter-tab],[data-payment-tab]');
  if (!el) { if (sidebarOpen && !e.target.closest('.sidebar')) { sidebarOpen = false; render(); } return; }
  if (el.dataset.view) { e.preventDefault(); currentView = el.dataset.view; sidebarOpen = false; render(); window.scrollTo({ top: 0 }); return; }
  if (el.dataset.meterTab) { meterTab = el.dataset.meterTab; render(); return; }
  if (el.dataset.paymentTab) { paymentTab = el.dataset.paymentTab; render(); return; }
  Promise.resolve(handleAction(el.dataset.action, el)).catch(error => toast(error.message));
});
document.addEventListener('change', e => { const key = e.target.dataset.filter; if (key) { filter[key] = e.target.value; render(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (root.firstElementChild) closeModal(); else if (sidebarOpen) { sidebarOpen = false; render(); } }
  if (e.key === 'Tab' && root.firstElementChild) {
    const focusable = [...root.querySelectorAll('button,input,select,textarea,a[href]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); }
    else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus(); }
  }
});
boot();
