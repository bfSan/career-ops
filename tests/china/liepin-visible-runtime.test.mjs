import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLiepinBatchPolicy} from '../../china/liepin-batch-policy.mjs';
import {createLiepinVisibleWorker} from '../../china/liepin-visible-worker.mjs';
import {createLiepinVisibleRuntime} from '../../china/liepin-visible-runtime.mjs';

const policy = createLiepinBatchPolicy(), HOME = 'https://www.liepin.com/zhaopin/';
const control = {url: 'chrome-extension://offline/control.html', frameId: 0};
const copy = value => JSON.parse(JSON.stringify(value));
function harness({city = '福州', keyword = 'AI Agent', count = 2} = {}) {
  let time = Date.parse('2026-10-18T00:00:00Z'), doc = 1, input = '', selected = '', dialog = false, cityInput = '', id = 10, href = HOME, owner, interval;
  const data = {}, tabs = new Map(), site = [], notices = [], listeners = {update: [], remove: []};
  const chrome = {runtime: {getURL: path => 'chrome-extension://offline/' + path, onMessage: {addListener() {}}}, storage: {local: {async get(keys) {return copy(Object.fromEntries(keys.filter(k => data[k] !== undefined).map(k => [k, data[k]])));}, async set(values) {Object.assign(data, copy(values));}}}, tabs: {async create(options) {const tab = {id: ++id, url: options.url}; tabs.set(tab.id, tab); return tab;}, async get(tabId) {return tabs.get(tabId);}, onUpdated: {addListener: fn => listeners.update.push(fn)}, onRemoved: {addListener: fn => listeners.remove.push(fn)}}};
  let worker = createLiepinVisibleWorker({chrome, policy, now: () => time}); worker.install();
  const from = () => ({url: href, tab: {id: owner, url: href}, documentId: 'doc-' + doc, frameId: 0});
  const jobs = Array.from({length: count}, (_, i) => ({url: 'https://www.liepin.com/' + (i % 2 ? 'a/' : 'job/') + (101 + i) + '.shtml?pgRef=visible', title: '可见岗位' + i, location: city + '·城区', company: '离线测试'}));
  const navigate = value => {href = value; doc++; tabs.get(owner).url = href;};
  const selectedHref = () => HOME + '?key=' + encodeURIComponent(keyword) + '&city=opaque-visible-city';
  const dom = {show: value => notices.push(value), snapshot(batch) {
    const u = new URL(href), expected = jobs.find(j => new URL(j.url).pathname === u.pathname);
    const s = {href, blank: false, gate: 'ok', inputValue: input, searchInput: true, searchButton: true, selectedCity: selected, cityQuote: selected ? '已选条件：\n' + selected : '', cityParam: u.searchParams.get('city') || '', cityDialog: dialog, cityInput: dialog, cityInputValue: cityInput, otherControl: true, exactCityOption: city === '福州' ? dialog && cityInput === city : true, jobs: jobs.slice(0), card: jobs[batch.records.length] || null, record: null};
    if (expected) s.record = {platform: 'liepin', url: 'https://www.liepin.com' + u.pathname, title: expected.title, location: expected.location, description: '负责生产级智能体开发、测试和部署，建设工具调用、评估监控与故障排查体系，能够完成完整的服务上线流程并保证稳定性。', captureMethod: 'browser_extension', complete: true, observedAt: new Date(time).toISOString(), searchContext: {batchId: batch.batchId, city: batch.city, keyword: batch.keyword, listingHref: batch.evidence?.href}};
    return s;
  }, prepare(kind, batch) {const snapshot = dom.snapshot(batch);return {snapshot, perform() {
    const persisted = data[worker.keys.batch]; assert.equal(persisted.pendingAction.kind, kind); assert.equal(persisted.pendingAction.dispatched, true, '点击前持久化stage/action并消费一次性许可');
    site.push({kind, at: time, stage: persisted.stage});
    if (kind === 'keyword-input') input = keyword;
    if (kind === 'search') navigate(HOME + '?key=' + encodeURIComponent(keyword));
    if (kind === 'city-other') dialog = true;
    if (kind === 'city-input') cityInput = city;
    if (kind === 'city-select') {selected = city;dialog = false;navigate(selectedHref());}
    if (kind === 'job-click') navigate(batch.jobs[batch.records.length].url);
    if (kind === 'history-back') navigate(selectedHref());
  }};}};
  const pageChrome = {runtime: {sendMessage: message => worker.dispatch(message, from())}};
  const runtime = createLiepinVisibleRuntime({chrome: pageChrome, dom, href: () => href, now: () => time});
  const getBatch = () => data[worker.keys.batch];
  return {chrome, data, site, notices, dom, jobs, runtime, get worker() {return worker;}, getBatch, href: () => href, from, advance: (ms = 1000) => {time += ms;}, now: () => time, navigate, async start() {const r = await worker.dispatch({type: 'START', city, keyword}, control);owner = r.batch.ownerTabId;href = HOME;return r;}, async run() {for (let i = 0; i < 250 && getBatch()?.status === 'running'; i++) {await runtime.tick();time += 1000;}return getBatch();}, recreate() {worker = createLiepinVisibleWorker({chrome, policy, now: () => time});worker.install();}, setOwner: n => {owner = n;}, listeners};
}

test('离线全链路福州两条：其他→搜索城市→精确城市，所有动作15秒且只搜索一次', async () => {
  const h = harness({count: 3}); await h.start();const done = await h.run();
  assert.equal(done.status, 'done', done.stopReason);assert.equal(done.records.length, 2);assert.equal(done.jobs.length, 2);
  assert.deepEqual(h.site.map(a => a.kind), ['keyword-input','search','city-other','city-input','city-select','job-click','history-back','job-click']);
  assert.equal(done.actions.filter(a => a.kind === 'search').length, 1);
  for (let i = 1; i < done.actions.length; i++) assert.ok(Date.parse(done.actions[i].at) - Date.parse(done.actions[i - 1].at) >= 15000);
  assert.ok(h.site[0].at - Date.parse(done.startedAt) >= 15000);
  const exported = await h.worker.dispatch({type:'EXPORT'}, control);assert.equal(exported.ok,true);assert.equal(policy.validateReceipt(exported.receipt).records.length,2);
  const auto = await Promise.all([h.worker.dispatch({type:'AUTO_EXPORT'},control),h.worker.dispatch({type:'AUTO_EXPORT'},control)]);
  assert.equal(auto.filter(r => r.ok).length,1);assert.equal(auto.filter(r => r.already).length,1);
  h.recreate();assert.equal((await h.worker.dispatch({type:'AUTO_EXPORT'},control)).already,true);
  const firstId=done.batchId;const start2=await h.start();assert.equal(start2.ok,false);assert.ok(start2.waitMs>0);
  h.advance(15000);const next=await h.start();assert.equal(next.ok,true);assert.notEqual(next.batch.batchId,firstId);assert.deepEqual(next.batch.records,[]);assert.deepEqual(next.batch.jobs,[]);
});

test('页面运行时严格无重入；非owner和旧批次消息不发送网站动作', async () => {
  const h=harness();await h.start();await Promise.all(Array.from({length:10},()=>h.runtime.tick()));
  assert.equal(h.getBatch().stage,'keyword-ready');assert.equal(h.site.length,0);
  h.setOwner(999);h.advance(30000);assert.equal((await h.runtime.tick()).owner,false);assert.equal(h.site.length,0);
  const state=h.getBatch();const r=await h.worker.dispatch({type:'RESERVE',batchId:'old',revision:state.revision,stage:state.stage,href:HOME,kind:'keyword-input',snapshot:{href:HOME,blank:false,gate:'ok',searchInput:true}},h.from());assert.equal(r.ok,false);assert.equal(h.site.length,0);
});

for (const bad of ['AI%2BAgent','AI%2520Agent','FDE']) test('精确关键词拒绝URL错误值 '+bad,async()=>{
  const h=harness();await h.start();while(h.getBatch().stage!=='search-await'){await h.runtime.tick();h.advance(15000);}
  h.navigate(HOME+'?key='+bad);await h.runtime.tick();
  assert.equal(h.getBatch().status,'stopped');assert.equal(h.site.some(a=>a.kind.startsWith('city-')),false);assert.equal((await h.worker.dispatch({type:'EXPORT'},control)).ok,false);
});

for (const gate of ['challenge','login_required','empty','blank']) test('门槛硬停并在worker/reload后保持：'+gate,async()=>{
  const h=harness();await h.start();const original=h.dom.snapshot;h.dom.snapshot=batch=>({...original(batch),gate:gate==='blank'?'ok':gate,blank:gate==='blank'});
  await h.runtime.tick();assert.equal(h.getBatch().status,'stopped');const before=h.site.length;h.recreate();h.advance(60000);await h.runtime.tick();assert.equal(h.site.length,before);assert.equal(h.getBatch().status,'stopped');
});

test('等待期间刷新后台状态；用户停止后不能消费或执行动作',async()=>{
  const h=harness();await h.start();await h.runtime.tick();await h.runtime.tick();assert.equal(h.site.length,0);assert.ok(h.notices.some(s=>s.includes('15秒')));
  await h.worker.dispatch({type:'CONTROL_STOP'},control);h.advance(60000);await h.runtime.tick();assert.equal(h.site.length,0);assert.equal(h.getBatch().status,'stopped');
});

test('后台独立监听owner safe/captcha URL；其他标签挑战不影响owner',async()=>{
  const h=harness();await h.start();const owner=h.getBatch().ownerTabId;
  for(const fn of h.listeners.update)fn(owner+1,{url:'https://safe.liepin.com/captcha/'},{url:'https://safe.liepin.com/captcha/'});await h.worker.idle();assert.equal(h.getBatch().status,'running');
  for(const fn of h.listeners.update)fn(owner,{url:'https://safe.liepin.com/captcha/'},{url:'https://safe.liepin.com/captcha/'});await h.worker.idle();assert.equal(h.getBatch().status,'stopped');
});

for (const field of ['title','location','url']) test('详情'+field+'变化停止且不能成功导出',async()=>{
  const h=harness();await h.start();const snapshot=h.dom.snapshot;h.dom.snapshot=batch=>{const s=snapshot(batch);if(s.record){s.record[field]=field==='url'?'https://www.liepin.com/job/999.shtml':field==='title'?'其他岗位':'北京·城区';}return s;};
  const result=await h.run();assert.equal(result.status,'stopped');assert.equal(result.records.length,0);assert.equal((await h.worker.dispatch({type:'EXPORT'},control)).ok,false);
});

test('刷新就绪页或旧格式状态不会重启/重复点击',async()=>{
  const h=harness();await h.start();await h.runtime.tick();h.navigate(HOME);await h.runtime.tick();assert.equal(h.getBatch().status,'stopped');assert.equal(h.site.length,0);
  h.advance(15000);await h.start();h.data[h.worker.keys.batch].version='old';await h.runtime.tick();assert.equal(h.getBatch().status,'stopped');assert.match(h.getBatch().stopReason,/旧格式/);
});

test('生成控制页VM自动导出仅一次，刷新不重复，默认配置保留且无站点请求',async()=>{
  const root=mkdtempSync(join(tmpdir(),'liepin-control-offline-'));
  try{
    const built=spawnSync(process.execPath,['china/build-liepin-extension.mjs'],{cwd:new URL('../..',import.meta.url),env:{...process.env,CAREER_OPS_ROOT:root,CAREER_OPS_CITY:'南京',CAREER_OPS_KEYWORD:'FDE'},encoding:'utf8'});assert.equal(built.status,0,built.stderr);
    const h=harness({count:1});await h.start();assert.equal((await h.run()).status,'done');
    const source=readFileSync(join(root,'data/china/extension/liepin-visible/control.js'),'utf8'),elements={},downloads=[],intervals=[];
    const makeContext=()=>({document:{querySelector:selector=>elements[selector]||=( {value:'',textContent:'',disabled:false}),createElement:()=>({click(){downloads.push(this.download);}})},chrome:{runtime:{sendMessage:message=>h.worker.dispatch(message,control)}},Blob:class{},URL:{createObjectURL:()=> 'blob:offline',revokeObjectURL(){}},setTimeout:()=>0,setInterval:fn=>{intervals.push(fn);return 0;}});
    vm.runInNewContext(source,makeContext());await new Promise(setImmediate);assert.equal(downloads.length,1);assert.equal(elements['#city'].value,'南京');assert.equal(elements['#keyword'].value,'FDE');
    for(const fn of intervals)await fn();assert.equal(downloads.length,1);
    vm.runInNewContext(source,makeContext());await new Promise(setImmediate);assert.equal(downloads.length,1);
    await elements['#export'].onclick();assert.equal(downloads.length,2,'手动可重新导出本批');
  }finally{rmSync(root,{recursive:true,force:true});}
});
