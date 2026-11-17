import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import worker from '../dist/server/index.js';
import {finances,validateState} from '../src/domain.js';

test('utility selection supports all receipts, apartments and custom groups, with queued monthly writes and reload',async t=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_milky_vulcan.sql',import.meta.url),'utf8'));
  t.after(()=>sqlite.close());
  const env={PRIVATE_SITE:'true',DB:{prepare(sql){return {values:[],bind(...v){this.values=v;return this;},async first(){return sqlite.prepare(sql).get(...this.values);},async run(){return sqlite.prepare(sql).run(...this.values);}};}}};
  let writes=0;
  const request=async(path,init={})=>{
    if(init.method==='PUT'){writes++;await new Promise(r=>setTimeout(r,35));}
    return worker.fetch(new Request(new URL(path,'https://test/'),{...init,headers:{...init.headers,Origin:'https://test'}}),env);
  };
  const get=async()=>(await request('/api/portfolio')).json();
  const seed=await get();
  seed.state.utilities.items=[['a','p231',100],['a2','p231',25],['b','p741',50],['c','p17',0],['hidden','p231',999]].map(([id,propertyId,average])=>({id,propertyId,average,label:'Квитанция '+id,due:'до 15',frequency:'monthly',active:id!=='hidden',note:''}));
  seed.state.utilities.marks={'2026-11':Object.fromEntries(seed.state.utilities.items.map(x=>[x.id,'green'])),'2026-12':{hidden:'green'}};
  seed.state.payments.push({id:'rent',propertyId:'p231',contractId:'c-p231',kind:'rent',date:'2026-11-06',period:'2026-11',amount:50000});
  assert.equal((await request('/api/portfolio',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(seed)})).status,200);
  writes=0;
  const html=await(await request('/')).text(),script=await(await request('/assets/app.js')).text();
  const wait=async fn=>{for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Bulk selection UI timed out');};
  const boot=async()=>{
    const dom=new JSDOM(html.replace('<script type="module" src="/assets/app.js"></script>',''),{url:'https://test/?view=utilities&period=2026-11',runScripts:'outside-only',pretendToBeVisual:true});
    t.after(()=>dom.window.close());
    const w=dom.window;w.structuredClone=structuredClone;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.fetch=request;w.eval(script);
    await wait(()=>w.document.querySelector('[data-utility-select-all]'));
    const q=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);return el;};
    const change=(selector,value)=>{const el=q(selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
    const color=value=>q(`[data-action="utility-bulk-color"][data-color="${value}"]`).click();
    return {dom,q,change,color};
  };
  const ui=await boot();
  assert.ok(ui.q('[data-action="utility-bulk-color"]').disabled);
  ui.change('[data-utility-select="a"]',true);
  assert.ok(ui.q('[data-utility-select-all]').indeterminate);
  assert.ok(ui.q('[data-utility-select-property="p231"]').indeterminate);
  assert.equal(ui.q('[data-utility-select-all]').getAttribute('aria-checked'),'mixed');
  ui.q('[data-action="utility-clear-selection"]').click();
  ui.change('[data-utility-select-property="p231"]',true);
  assert.ok(ui.q('[data-utility-select="a"]').checked);assert.ok(ui.q('[data-utility-select="a2"]').checked);
  assert.equal(ui.q('[data-utility-select="b"]').checked,false);
  assert.equal(writes,0,'Selecting receipts must not save colors');
  ui.color('red');
  await wait(async()=>{const s=await get();return s.state.utilities.marks['2026-11'].a2==='red'&&ui.q('[data-action="utility-bulk-color"]').disabled;});
  let saved=await get();assert.equal(writes,1,'One batch must use one portfolio write');
  assert.equal(saved.state.utilities.marks['2026-11'].a,'red');assert.equal(saved.state.utilities.marks['2026-11'].b,'green');
  assert.equal(saved.state.utilities.marks['2026-11'].hidden,'green');

  // Change the month while the first batch is pending, then queue a second batch.
  ui.change('[data-utility-select="a"]',true);ui.change('[data-utility-select="b"]',true);ui.color('orange');
  ui.change('[data-utility-period]','2026-12');
  assert.ok(ui.q('[data-action="utility-bulk-color"]').disabled,'A new month starts without a selection');
  ui.change('[data-utility-select-property="p17"]',true);ui.color('green');
  await wait(async()=>{const s=await get();return s.state.utilities.marks['2026-12']?.c==='green'&&ui.q('[data-action="utility-bulk-color"]').disabled;});
  saved=await get();assert.equal(writes,3);
  assert.equal(saved.state.utilities.marks['2026-11'].a,'orange');assert.equal(saved.state.utilities.marks['2026-11'].b,'orange');
  assert.equal(saved.state.utilities.marks['2026-11'].a2,'red');assert.equal(saved.state.utilities.marks['2026-12'].a,undefined);
  assert.equal(saved.state.utilities.marks['2026-12'].hidden,'green');

  ui.change('[data-filter="propertyId"]','p741');ui.change('[data-utility-select-all]',true);ui.color('green');
  await wait(async()=>(await get()).state.utilities.marks['2026-12']?.b==='green');
  await wait(()=>ui.q('[data-action="utility-bulk-color"]').disabled);
  ui.change('[data-filter="propertyId"]','all');ui.change('[data-utility-hidden]',true);
  assert.ok(ui.q('[data-utility-select="hidden"]').disabled);
  ui.change('[data-utility-select-all]',true);
  assert.equal(ui.dom.window.document.querySelectorAll('[data-utility-select]:checked').length,4);
  ui.color('red');await wait(()=>ui.q('[data-action="utility-bulk-color"]').disabled);
  saved=await get();assert.equal(writes,5);
  for(const id of ['a','a2','b','c'])assert.equal(saved.state.utilities.marks['2026-12'][id],'red');
  assert.equal(saved.state.utilities.marks['2026-12'].hidden,'green');
  const original=structuredClone(seed.state),actual=structuredClone(saved.state);
  delete original.utilities.marks;delete actual.utilities.marks;
  assert.deepEqual(actual,original);assert.deepEqual(finances(saved.state,{year:2026}),finances(seed.state,{year:2026}));validateState(saved.state);
  const reloaded=await boot();
  assert.equal(reloaded.q('[data-utility-color="a"]').value,'orange');
  assert.equal(reloaded.q('[data-utility-color="a2"]').value,'red');
  assert.equal(reloaded.dom.window.document.querySelectorAll('[data-utility-select]:checked').length,0);
  assert.equal(writes,5,'Reloading must not create marks or payments');
});
