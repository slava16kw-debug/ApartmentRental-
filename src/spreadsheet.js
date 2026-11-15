import ExcelJS from 'exceljs';
import { uid, today, monthOf, MONTHS, CATEGORIES, RESOURCES, finances, validateState } from './domain.js';

const val = cell => { const v = cell?.value; if (v == null) return ''; if (v instanceof Date) return v; if (typeof v === 'object') return v.result ?? v.text ?? v.richText?.map(r => r.text).join('') ?? ''; return v; };
const txt = v => String(v ?? '').trim();
const numeric = v => typeof v === 'number' ? v : /^-?\d+(?:[.,]\d+)?$/.test(txt(v).replace(/\s/g, '')) ? Number(txt(v).replace(/\s/g, '').replace(',', '.')) : null;
function dateOf(v) { if (v instanceof Date) return v.toISOString().slice(0, 10); if (/^\d{4}-\d{2}-\d{2}/.test(txt(v))) return txt(v).slice(0, 10); const m = txt(v).match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; }
function category(note) { const t = note.toLowerCase(); return /поверк/.test(t) ? 'Поверка счётчиков' : /жкх|коммун/.test(t) ? 'ЖКХ' : /кот[её]л|ремонт|компрессор|диагност|шланг|слив|обслуж/.test(t) ? 'Ремонт и обслуживание' : 'Прочее'; }
const propertyBy = (s, value) => s.properties.find(p => p.id === value || p.title === value || p.address === value || (value && (p.address.includes('кв. ' + value) || p.title.includes(String(value)))));
function csvRows(text) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const out = []; let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (!quote && c === delimiter) { row.push(cell); cell = ''; }
    else if (!quote && (c === '\n' || c === '\r')) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
export async function readWorkbook(file, state) {
  if (file.size > 10 * 1024 * 1024) throw Error('Размер файла должен быть до 10 МБ.');
  const candidates = [], warnings = [], seen = new Set(state.importKeys);
  let duplicates = 0;
  const push = (kind, payload, source, label) => {
    const key = [kind, payload.propertyId || payload.meterId, payload.date, payload.period || '', payload.value ?? payload.amount, payload.kind || '', payload.note || ''].join('|');
    if (seen.has(key)) { duplicates++; return; }
    if (kind === 'reading' && state.readings.some(r => r.meterId === payload.meterId && r.date === payload.date)) { duplicates++; return; }
    if (kind === 'payment' && state.payments.some(p => p.propertyId === payload.propertyId && p.period === payload.period && p.date === payload.date && p.amount === payload.amount && p.kind === payload.kind)) { duplicates++; return; }
    if (kind === 'expense' && state.expenses.some(e => e.propertyId === payload.propertyId && e.date === payload.date && e.amount === payload.amount && e.note === payload.note)) { duplicates++; return; }
    seen.add(key); candidates.push({ key, kind, payload, source, label, selected: kind === 'reading' && payload.date <= today() });
  };
  if (file.name.toLowerCase().endsWith('.csv')) {
    const rows = csvRows((await file.text()).replace(/^\uFEFF/, ''));
    const headers = rows[0]?.map(h => h.trim().toLowerCase());
    if (!headers?.includes('тип') || !headers.includes('квартира') || !headers.includes('дата')) throw Error('Для CSV нужны столбцы «Тип», «Квартира», «Дата», «Ресурс», «Значение», «Сумма», «Период», «Категория», «Комментарий». Можно использовать экспорт CSV из приложения.');
    for (let i = 1; i < rows.length && i < 10000; i++) {
      const r = Object.fromEntries(headers.map((h, j) => [h, rows[i][j] || ''])), p = propertyBy(state, r['квартира']);
      if (!p) { if (rows[i].some(Boolean)) warnings.push(`Строка ${i + 1}: квартира не распознана.`); continue; }
      const date = dateOf(r['дата']), type = r['ресурс'];
      if (r['тип'] === 'reading' && RESOURCES[type]) { const m = state.meters.find(m => !m.retired && m.propertyId === p.id && m.type === type); if (m) push('reading', { id: uid(), meterId: m.id, date, value: numeric(r['значение']), note: r['комментарий'] }, `CSV · ${i + 1}`, `${p.title} · ${RESOURCES[type].label}`); }
      else if (r['тип'] === 'expense') push('expense', { id: uid(), propertyId: p.id, date, amount: numeric(r['сумма']), category: CATEGORIES.includes(r['категория']) ? r['категория'] : 'Прочее', paid: false, paidDate: '', payer: 'owner', period: r['период'], note: r['комментарий'] }, `CSV · ${i + 1}`, `${p.title} · ${r['категория'] || 'Расход'}`);
      else if (['rent', 'reimbursement', 'deposit_in', 'deposit_out'].includes(r['тип'])) push('payment', { id: uid(), propertyId: p.id, date, datePrecision: r['точность даты'] || 'day', amount: numeric(r['сумма']), kind: r['тип'], period: r['период'], method: 'Импорт CSV', note: r['комментарий'] }, `CSV · ${i + 1}`, `${p.title} · ${r['тип']}`);
    }
  } else {
    if (!/\.xlsx$/i.test(file.name)) throw Error('Выберите файл XLSX или CSV. Старый XLS сначала сохраните как XLSX.');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    if (wb.worksheets.length > 30) throw Error('В файле слишком много листов.');
    let found = false;
    for (const sheet of wb.worksheets) {
      const year = Number(sheet.name.match(/20\d{2}/)?.[0]); if (!year) continue;
      const limit = Math.min(sheet.rowCount, 5000);
      let header, blocks = [];
      for (let r = 1; r <= Math.min(limit, 80); r++) {
        const row = sheet.getRow(r), cols = [];
        row.eachCell((c, col) => { if (/^месяц/i.test(txt(val(c)))) cols.push(col); });
        if (cols.length >= 3) { header = r; blocks = cols.slice(0, 3); break; }
      }
      if (!header) continue; found = true;
      const ps = [state.properties.find(p => p.id === 'p231') || state.properties[0], state.properties.find(p => p.id === 'p741') || state.properties[1], state.properties.find(p => p.id === 'p17') || state.properties[2]];
      for (let b = 0; b < blocks.length; b++) {
        const p = ps[b], col = blocks[b]; if (!p) continue;
        let seenDecember = false;
        for (let r = header + 1; r <= Math.min(limit, header + 15); r++) {
          const label = txt(val(sheet.getCell(r, col))).toLowerCase();
          const mi = MONTHS.findIndex(m => label.startsWith(m.toLowerCase())); if (mi < 0) continue;
          const suffix = label.match(/(?:^|\s)(20\d{2}|\d{2})(?:$|\s)/)?.[1];
          const explicitYear = suffix ? (suffix.length === 2 ? 2000 + Number(suffix) : Number(suffix)) : year;
          const nextYear = mi === 0 && (seenDecember || r >= header + 13 || explicitYear > year);
          if (mi === 11) seenDecember = true;
          const actualYear = explicitYear > year ? explicitYear : nextYear ? year + 1 : year;
          const period = `${actualYear}-${String(mi + 1).padStart(2, '0')}`, date = period + '-01';
          for (const [offset, type] of [[1, 'water'], [2, 'gas'], [3, 'power']]) {
            const raw = val(sheet.getCell(r, col + offset)); if (raw === '' || raw == null) continue;
            const value = numeric(raw), meter = state.meters.find(m => m.propertyId === p.id && m.type === type && !m.retired);
            if (value === null || value < 0 || !meter) { warnings.push(`${sheet.name}!${sheet.getCell(r, col + offset).address}: показание «${raw}» требует ручной проверки.`); continue; }
            push('reading', { id: uid(), meterId: meter.id, date, value, note: 'Из исходного Excel' }, `${sheet.name}!${sheet.getCell(r, col + offset).address}`, `${p.title} · ${RESOURCES[type].label}`);
          }
          if (!nextYear && b < 2 && year >= 2023) {
            const raw = val(sheet.getCell(r, col + 4)), n = numeric(raw);
            if (n && n > 0) push('payment', { id: uid(), propertyId: p.id, kind: 'rent', amount: n * 1000, period, date: period + '-01', datePrecision: 'month', method: 'Импорт Excel', note: 'Известен только месяц получения. 1-е число — техническая дата для месячного учёта, точный день не указан в источнике.' }, `${sheet.name}!${sheet.getCell(r, col + 4).address}`, `${p.title} · аренда за ${MONTHS[mi].toLowerCase()} (× 1 000)`);
          }
          if (nextYear) break;
        }
      }
      for (let r = 1; r <= limit; r++) {
        const row = sheet.getRow(r);
        for (let col = Math.max(1, blocks[2] + 6); col <= Math.min(sheet.columnCount - 3, 45); col++) {
          const date = dateOf(val(row.getCell(col))); if (!date) continue;
          const flat = txt(val(row.getCell(col + 1))), p = propertyBy(state, flat), note = txt(val(row.getCell(col + 2))), value = numeric(val(row.getCell(col + 3)));
          if (!p || !value || value <= 0) continue;
          push('expense', { id: uid(), propertyId: p.id, date, amount: value, category: category(note), note, payer: 'owner', paid: false, paidDate: '', period: '' }, `${sheet.name}!${row.getCell(col).address}`, `${p.title} · ${note}`);
        }
      }
      if (year === 2022) warnings.push('2022: арендные суммы имеют накопительный формат. Автоматический перенос поступлений отключён; показания и отдельные расходы распознаны.');
    }
    if (!found) throw Error('Не найдена структура исходного Excel. Для универсального переноса используйте CSV по шаблону приложения или полную резервную JSON-копию.');
    warnings.unshift('В исходном Excel нет точных дат получения аренды. Для денежных итогов по годам платежи предложены с условной датой 1-го числа соответствующего месяца. Перед подтверждением их можно исключить, а после импорта — исправить даты в истории.');
  }
  return { candidates, warnings: [...new Set(warnings)].slice(0, 30), duplicates };
}
export async function exportWorkbook(state, year) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Мои квартиры'; wb.created = new Date();
  const addSheet = (title, headers, rows) => {
    const s = wb.addWorksheet(title); s.addRow(headers); rows.forEach(r => s.addRow(r));
    s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; s.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22694F' } }; s.getRow(1).height = 25;
    s.views = [{ state: 'frozen', ySplit: 1 }]; s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    s.columns.forEach((c, i) => { c.width = Math.min(60, Math.max(17, ...rows.slice(0, 150).map(r => String(r[i] ?? '').length + 3), headers[i].length + 3)); });
  };
  const property = id => state.properties.find(p => p.id === id)?.title || id;
  const yearly = finances(state, { year });
  const report = state.properties.map(p => { const f = finances(state, { year, propertyId: p.id }); return [p.title, p.use === 'home' ? 'Своё жильё' : 'Аренда', f.rent, f.reimbursements, p.use === 'home' ? f.homeExpenses : f.expenses, p.use === 'home' ? null : f.profit]; });
  if (yearly.rentAdjustment) report.push(['Нераспределённая сверка года', 'Годовой итог', yearly.rentAdjustment, 0, 0, yearly.rentAdjustment], ['Итого по аренде', '', yearly.rent, yearly.reimbursements, yearly.expenses, yearly.profit]);
  addSheet('Отчёт ' + year, ['Квартира', 'Назначение', 'Получено аренды, ₽', 'Возмещения, ₽', 'Расходы, ₽', 'Прибыль от аренды, ₽'], report);
  if (Object.keys(state.settings.annualRentTotals || {}).length) addSheet('Сверка годов', ['Год', 'По месячным записям, ₽', 'Подтверждённый итог, ₽', 'Разница, ₽', 'Комментарий'], Object.entries(state.settings.annualRentTotals).map(([y, confirmation]) => { const f = finances(state, { year: y }); return [y, f.recordedRent, confirmation.amount, f.rentAdjustment, confirmation.note || '']; }));
  addSheet('Поступления', ['ID', 'Дата', 'Квартира', 'Вид', 'За месяц', 'Сумма, ₽', 'Способ', 'Комментарий', 'Точность даты'], state.payments.map(p => [p.id, p.datePrecision === 'month' ? p.date.slice(0, 7) : p.date, property(p.propertyId), p.kind, p.period, p.amount, p.method, p.note, p.datePrecision === 'month' ? 'Только месяц' : 'Точная дата']));
  addSheet('Расходы', ['ID', 'Дата', 'Квартира', 'Категория', 'Сумма, ₽', 'Оплачен', 'Дата оплаты', 'Плательщик', 'Период', 'Комментарий'], state.expenses.map(e => [e.id, e.date, property(e.propertyId), e.category, e.amount, e.paid ? 'Да' : 'Нет', e.paidDate, e.payer, e.period, e.note]));
  addSheet('Показания', ['ID', 'Дата', 'Квартира', 'Ресурс', 'Значение', 'Единица', 'ID счётчика', 'Комментарий'], state.readings.map(r => { const m = state.meters.find(m => m.id === r.meterId); return [r.id, r.date, property(m.propertyId), RESOURCES[m.type].label, r.value, RESOURCES[m.type].unit, m.id, r.note]; }));
  addSheet('Договоры', ['Квартира', 'Арендатор', 'Телефон', 'Начало', 'Окончание', 'Аренда, ₽', 'День оплаты', 'Залог, ₽', 'Комментарий'], state.contracts.map(c => [property(c.propertyId), c.tenant, c.phone, c.start, c.end, c.rent, c.dueDay, c.deposit, c.note]));
  addSheet('Счётчики', ['ID', 'Квартира', 'Ресурс', 'Номер', 'Следующая поверка', 'Заменён'], state.meters.map(m => [m.id, property(m.propertyId), RESOURCES[m.type].label, m.serial, m.due, m.retired ? 'Да' : 'Нет']));
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export function exportCSV(state) {
  const rows = [['Тип', 'Квартира', 'Дата', 'Ресурс', 'Значение', 'Сумма', 'Период', 'Категория', 'Комментарий', 'Точность даты']];
  state.readings.forEach(r => { const m = state.meters.find(m => m.id === r.meterId); rows.push(['reading', m.propertyId, r.date, m.type, r.value, '', '', '', r.note]); });
  state.payments.forEach(p => rows.push([p.kind, p.propertyId, p.date, '', '', p.amount, p.period, '', p.note, p.datePrecision || 'day']));
  state.expenses.forEach(e => rows.push(['expense', e.propertyId, e.date, '', '', e.amount, e.period, e.category, e.note]));
  const safe = x => { let v = String(x ?? ''); if (/^[=+@\-]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  return new Blob(['\uFEFF' + rows.map(r => r.map(safe).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
