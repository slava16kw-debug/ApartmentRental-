import { cents, money, MONTHS } from './domain.js';
import { icon } from './icons.js';

export const UTILITY_COLORS = { red: 'Красный', orange: 'Оранжевый', green: 'Зелёный' };
export const UTILITY_FREQUENCIES = { monthly: 'Ежемесячно', quarterly: 'Раз в квартал', annual: 'Раз в год', other: 'Другой график' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const validPeriod = p => /^20\d{2}-(0[1-9]|1[0-2])$/.test(p);
export function utilityData(state) { return state.utilities ||= { items: [], marks: {}, propertyNotes: {} }; }
export function utilityItems(state, propertyId = 'all', includeHidden = false) { return (state.utilities?.items || []).filter(x => (includeHidden || x.active !== false) && (propertyId === 'all' || x.propertyId === propertyId)); }
export function utilityColor(state, id, period) { return state.utilities?.marks?.[period]?.[id] || 'red'; }
export function utilityAverage(state, propertyId = 'all') { return utilityItems(state, propertyId).reduce((sum, x) => sum + cents(x.average), 0) / 100; }
export function setUtilityColor(state, id, period, color) {
  if (!validPeriod(period) || !Object.hasOwn(UTILITY_COLORS, color) || !utilityItems(state, 'all', true).some(x => x.id === id)) throw Error('Проверьте квитанцию, месяц и цвет отметки.');
  const data = utilityData(state); data.marks[period] ||= {}; data.marks[period][id] = color;
}
export function resetUtilityColors(state, period, propertyId = 'all') { for (const item of utilityItems(state, propertyId)) setUtilityColor(state, item.id, period, 'red'); }

export function renderUtilities(state, { period, propertyId = 'all', showHidden = false }) {
  const properties = state.properties.filter(p => propertyId === 'all' || p.id === propertyId);
  const items = utilityItems(state, propertyId), hidden = utilityItems(state, propertyId, true).filter(x => x.active === false).length;
  const periodLabel = `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0,4)}`;
  const counts = Object.fromEntries(Object.keys(UTILITY_COLORS).map(c => [c, items.filter(x => utilityColor(state,x.id,period) === c).length]));
  const rentalAverage = properties.filter(p => p.use === 'rental').reduce((sum,p) => sum+cents(utilityAverage(state,p.id)),0)/100;
  const homeAverage = properties.filter(p => p.use === 'home').reduce((sum,p) => sum+cents(utilityAverage(state,p.id)),0)/100;
  return `<section class="utilities-view" aria-label="ЖКХ: ориентиры и отметки оплаты">
    <div class="utility-filters"><label class="select-wrap">${icon('calendar')}<span>Месяц отметок</span><input type="month" data-utility-period aria-label="Месяц отметок ЖКХ" value="${esc(period)}" min="2000-01" max="2099-12"></label><label class="select-wrap">${icon('building')}<select data-filter="propertyId" aria-label="Квартира ЖКХ"><option value="all">Все квартиры</option>${state.properties.map(p=>`<option value="${esc(p.id)}" ${p.id===propertyId?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label>${hidden ? `<label class="check-line"><input type="checkbox" data-utility-hidden ${showHidden?'checked':''}>Показать скрытые (${hidden})</label>` : ''}<span class="utility-period-label">${esc(periodLabel)}</span></div>
    <div class="utility-summary"><div><span>Все выбранные квартиры · ориентир / мес.</span><strong>${money(utilityAverage(state,propertyId))}</strong></div><div><span>Сдаваемые квартиры / мес.</span><strong>${money(rentalAverage)}</strong></div><div><span>Своё жильё / мес.</span><strong>${money(homeAverage)}</strong></div></div>
    <div class="utility-legend"><span class="utility-key red"><i></i>Красный — не оплачено (${counts.red})</span><span class="utility-key orange"><i></i>Оранжевый — проверить (${counts.orange})</span><span class="utility-key green"><i></i>Зелёный — оплачено (${counts.green})</span><span>Отметки сохраняются отдельно для каждого месяца</span></div>
    <div class="utility-grid">${properties.map(p => {
      const rows = utilityItems(state,p.id,showHidden);
      const variant = ['blue','sand','mint'][state.properties.findIndex(x=>x.id===p.id)%3];
      return `<section class="utility-card ${variant}" data-utility-property="${esc(p.id)}"><header class="utility-card-head"><div><h2>${esc(p.title)}</h2><p>${esc(p.address || 'Адрес можно указать в карточке квартиры')}</p></div><button type="button" class="icon-btn" data-action="utility-notes" data-id="${esc(p.id)}" aria-label="Примечания: ${esc(p.title)}">${icon('edit')}</button></header><div class="utility-card-meta"><span>Квитанций и услуг: ${utilityItems(state,p.id).length}</span><strong>${money(utilityAverage(state,p.id))}<small>ориентир / мес.</small></strong></div><div class="table-wrap"><table class="utility-table"><thead><tr><th>№</th><th>Квитанция / срок</th><th>Среднее, ₽/мес.</th><th>Цвет</th><th></th></tr></thead><tbody>${rows.map((item,i)=>{
        const color=utilityColor(state,item.id,period);
        return `<tr class="utility-row utility-row-${color} ${item.active===false?'utility-hidden':''}" data-utility-row="${esc(item.id)}"><td class="utility-index">${i+1}</td><td><button type="button" class="utility-name" data-action="utility-item" data-id="${esc(item.id)}">${esc(item.label)}</button><small>${esc(item.due || UTILITY_FREQUENCIES[item.frequency])}${item.frequency!=='monthly' && item.due && !(item.frequency==='quarterly' && /квартал/i.test(item.due)) && !(item.frequency==='annual' && /год/i.test(item.due))?' · '+esc(UTILITY_FREQUENCIES[item.frequency]):''}</small>${item.note?`<small class="utility-note">${esc(item.note)}</small>`:''}${item.active===false?'<small>Скрытая квитанция</small>':''}</td><td class="utility-average"><button type="button" data-action="utility-item" data-id="${esc(item.id)}" aria-label="Изменить среднюю сумму: ${esc(item.label)}">${money(item.average)}</button></td><td><select class="utility-status utility-status-${color}" data-utility-color="${esc(item.id)}" aria-label="Цвет: ${esc(item.label)}, ${esc(p.title)}" ${item.active===false?'disabled':''}>${Object.entries(UTILITY_COLORS).map(([v,label])=>`<option value="${v}" ${v===color?'selected':''}>${label}</option>`).join('')}</select></td><td><button type="button" class="icon-btn" data-action="utility-item" data-id="${esc(item.id)}" aria-label="Редактировать: ${esc(item.label)}">${icon('edit')}</button></td></tr>`;
      }).join('') || '<tr><td colspan="5" class="utility-empty">Квитанций пока нет</td></tr>'}</tbody><tfoot><tr><th colspan="2" scope="row">Итого по всем строкам / мес.</th><td colspan="3">${money(utilityAverage(state,p.id))}</td></tr></tfoot></table></div><div class="utility-card-bottom">${state.utilities?.propertyNotes?.[p.id]?`<p>${esc(state.utilities.propertyNotes[p.id])}</p>`:''}<button type="button" class="text-button" data-action="utility-item" data-property="${esc(p.id)}">${icon('plus')}Добавить квитанцию</button></div></section>`;
    }).join('')}</div>
    <div class="utility-footnote">Средние суммы нужны для наглядности: итог считается по всем активным строкам, включая капремонт и подписки. Скрытые квитанции в сумму не входят. Вы можете менять суммы, названия и сроки. Ориентиры текущие, а цвета относятся к выбранному месяцу. Цветовая отметка и ориентировочная сумма не создают фактический расход и не меняют прибыль. Оплаченные расходы вносите во вкладке «Расходы».</div>
  </section>`;
}
