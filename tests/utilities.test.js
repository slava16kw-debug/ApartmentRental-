import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {initialState,validateState,finances} from '../src/domain.js';
import {utilityItems,utilityColor,utilityAverage,setUtilityColor,resetUtilityColors,renderUtilities} from '../src/utilities.js';

function sample() {
  const s=initialState({},'2026-11-01');
  s.utilities.items=[['a','p231',100],['b','p741',50],['c','p17',0]].map(([id,propertyId,average])=>({id,propertyId,average,label:'Квитанция '+id,due:'до 15',frequency:'monthly',active:true,note:''}));
  return s;
}
test('utility colors are monthly, reset respects the selected property, and averages never become actual expenses',()=>{
  const s=sample(),financial=finances(s,{year:2026});
  assert.equal(utilityAverage(s),150);assert.equal(utilityAverage(s,'p17'),0);
  const before=JSON.stringify(s);
  assert.equal(utilityColor(s,'a','2026-12'),'red');assert.equal(JSON.stringify(s),before,'Viewing a new month must not write marks');
  setUtilityColor(s,'a','2026-11','green');setUtilityColor(s,'b','2026-11','orange');
  setUtilityColor(s,'a','2026-12','green');setUtilityColor(s,'b','2026-12','green');
  resetUtilityColors(s,'2026-12','p231');
  assert.equal(utilityColor(s,'a','2026-12'),'red');assert.equal(utilityColor(s,'b','2026-12'),'green');
  assert.equal(utilityColor(s,'a','2026-11'),'green');assert.equal(utilityColor(s,'b','2026-11'),'orange');
  s.utilities.items[0].average=200;s.utilities.items[1].active=false;
  assert.equal(utilityAverage(s),200);assert.equal(utilityItems(s).length,2);assert.equal(utilityItems(s,'all',true).length,3);
  validateState(s);assert.deepEqual(finances(s,{year:2026}),financial);assert.equal(s.expenses.length,0);assert.equal(s.payments.length,0);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s,'A full backup preserves utility data');
});
test('utility validation rejects bad amounts, references, colors, periods and duplicate ids, while old backups remain valid',()=>{
  const old=sample();delete old.utilities;validateState(old);
  const changes=[s=>s.utilities.items[0].average=-1,s=>s.utilities.items[0].average=NaN,s=>s.utilities.items[0].label='',s=>s.utilities.items[0].propertyId='missing',s=>s.utilities.items.push({...s.utilities.items[0]}),s=>s.utilities.marks={'2026-13':{a:'red'}},s=>s.utilities.marks={'2026-11':{a:'blue'}},s=>s.utilities.marks={'2026-11':{missing:'green'}},s=>s.utilities.propertyNotes={missing:'note'},s=>s.utilities=null];
  for(const change of changes){const s=sample();change(s);assert.throws(()=>validateState(s));}
  assert.throws(()=>setUtilityColor(sample(),'a','2026-13','red'));
  assert.throws(()=>setUtilityColor(sample(),'missing','2026-11','green'));
});
test('utilities render safe editable rows and keep zero monthly averages visible',()=>{
  const s=sample();s.utilities.items[0].label='<img src=x onerror=alert(1)>';setUtilityColor(s,'a','2026-11','green');
  const before=JSON.stringify(s),dom=new JSDOM(renderUtilities(s,{period:'2026-11'}));
  const d=dom.window.document;
  assert.equal(d.querySelectorAll('.utility-card').length,3);assert.equal(d.querySelectorAll('[data-utility-color]').length,3);
  assert.equal(d.querySelector('[data-utility-color="a"]').value,'green');assert.equal(d.querySelectorAll('.utility-status option').length,9);
  assert.equal(d.querySelector('img'),null);assert.match(d.querySelector('[data-utility-row="a"]').textContent,/<img/);
  assert.match(d.querySelector('[data-utility-row="c"] .utility-average').textContent,/0/);
  assert.equal(JSON.stringify(s),before);dom.window.close();
});
