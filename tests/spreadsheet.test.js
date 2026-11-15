import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { initialState } from '../src/domain.js';
import { readWorkbook, exportWorkbook, exportCSV } from '../src/spreadsheet.js';

test('legacy workbook separates readings, thousands of rent, ruble expenses, and annual totals', async () => {
  const wb = new ExcelJS.Workbook(), sh = wb.addWorksheet('2026');
  for (const col of [3, 10, 17]) { sh.getCell(25, col).value = 'Месяц'; sh.getCell(25, col + 1).value = 'Хол.вода'; }
  for (const [r, month, value] of [[26, 'Январь', 858], [27, 'Февраль', 870]]) {
    for (const col of [3, 10, 17]) { sh.getCell(r, col).value = month; sh.getCell(r, col + 1).value = value; }
    sh.getCell(r, 7).value = 50; sh.getCell(r, 14).value = 35;
  }
  sh.getCell('Z26').value = new Date('2026-01-05T00:00:00Z'); sh.getCell('AA26').value = 741; sh.getCell('AB26').value = 'Ремонт котла'; sh.getCell('AC26').value = 12000;
  sh.getCell('C38').value = 'Январь 27'; sh.getCell('G38').value = 600; sh.getCell('N38').value = 350;
  const buffer = await wb.xlsx.writeBuffer();
  const s = initialState({}, '2026-11-15'); s.properties[0].address = 'кв. 231'; s.properties[1].address = 'кв. 741';
  const file = new File([buffer], 'history.xlsx'); const parsed = await readWorkbook(file, s);
  assert.equal(parsed.candidates.filter(c => c.kind === 'reading').length, 6);
  assert.deepEqual(parsed.candidates.filter(c => c.kind === 'payment').map(c => c.payload.amount), [50000, 50000, 35000, 35000]);
  assert.equal(parsed.candidates.filter(c => c.kind === 'expense')[0].payload.amount, 12000);
  assert.ok(parsed.candidates.filter(c => c.kind === 'payment').every(c => !c.selected));
  assert.ok(parsed.candidates.filter(c => c.kind === 'payment').every(c => c.payload.datePrecision === 'month'));
  assert.ok(!parsed.candidates.some(c => c.payload.amount === 600000));
  s.importKeys = parsed.candidates.map(c => c.key); const again = await readWorkbook(file, s); assert.equal(again.candidates.length, 0);
});
test('exported XLSX is readable and CSV export can be previewed for re-import', async () => {
  const s = initialState({}, '2026-11-15'); s.readings.push({ id: 'r1', meterId: 'p231-water', date: '2026-01-01', value: 100, note: '' });
  const blob = await exportWorkbook(s, 2026); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blob.arrayBuffer());
  assert.equal(wb.getWorksheet('Показания').getCell('E2').value, 100);
  const csv = exportCSV(s), f = new File([csv], 'export.csv'); const empty = initialState({}, '2026-11-15'); const parsed = await readWorkbook(f, empty);
  assert.equal(parsed.candidates[0].payload.value, 100); assert.equal(parsed.candidates[0].kind, 'reading');
});

test('CSV preserves month-only precision and Excel export does not assert a receipt day', async () => {
  const s = initialState({}, '2026-11-15');
  s.payments.push({ id: 'p', propertyId: 'p231', contractId: 'c-p231', kind: 'rent', amount: 50000, period: '2026-11', date: '2026-11-01', datePrecision: 'month', note: 'День неизвестен' });
  const parsed = await readWorkbook(new File([exportCSV(s)], 'export.csv'), initialState({}, '2026-11-15'));
  assert.equal(parsed.candidates[0].payload.datePrecision, 'month');
  const blob = await exportWorkbook(s, 2026), wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blob.arrayBuffer());
  assert.equal(wb.getWorksheet('Поступления').getCell('B2').value, '2026-11');
  assert.equal(wb.getWorksheet('Поступления').getCell('I2').value, 'Только месяц');
});

test('zero rent remains zero in CSV round trips and Excel exports', async () => {
  const s = initialState({}, '2026-11-15');
  s.payments.push({ id: 'vacant', propertyId: 'p741', contractId: '', kind: 'rent', amount: 0, period: '2026-10', date: '2026-10-01', datePrecision: 'month', note: 'Нет жильцов' });
  const parsed = await readWorkbook(new File([exportCSV(s)], 'export.csv'), initialState({}, '2026-11-15'));
  assert.equal(parsed.candidates.length, 1); assert.equal(parsed.candidates[0].payload.amount, 0);
  const wb = new ExcelJS.Workbook(), blob = await exportWorkbook(s, 2026); await wb.xlsx.load(await blob.arrayBuffer());
  assert.equal(wb.getWorksheet('Поступления').getCell('F2').value, 0);
});

test('Excel report exposes annual reconciliation separately from the original receipts', async () => {
  const s = initialState({}, '2024-01-01');
  s.payments.push({id:'rent',propertyId:'p231',contractId:'c-p231',kind:'rent',period:'2024-01',date:'2024-01-06',amount:10000});
  s.settings.annualRentTotals = {'2024':{amount:9000,note:'Требуется уточнить месяцы'}};
  const wb = new ExcelJS.Workbook(), blob = await exportWorkbook(s,2024); await wb.xlsx.load(await blob.arrayBuffer());
  const report=wb.getWorksheet('Отчёт 2024');
  assert.equal(report.getCell('A5').value,'Нераспределённая сверка года'); assert.equal(report.getCell('C5').value,-1000);
  assert.equal(report.getCell('C6').value,9000); assert.equal(report.getCell('F6').value,9000);
  assert.equal(wb.getWorksheet('Поступления').getCell('F2').value,10000);
  assert.equal(wb.getWorksheet('Сверка годов').getCell('C2').value,9000);
});
