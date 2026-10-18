import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiepinBatchPolicy} from '../../china/liepin-batch-policy.mjs';
import {createLiepinVisibleWorker} from '../../china/liepin-visible-worker.mjs';
import {createLiepinVisibleRuntime} from '../../china/liepin-visible-runtime.mjs';

const policy = createLiepinBatchPolicy();
const HOME = 'https://www.liepin.com/zhaopin/';
const CONTROL = {url: 'chrome-extension://offline/control.html', frameId: 0};
const clone = value => JSON.parse(JSON.stringify(value));

function fixture({mode = 'skeleton'} = {}) {
  let now = Date.parse('2026-10-18T01:00:00Z'), owner = null, href = HOME, doc = 1, ready = false;
  const data = {}, tabs = new Map(), notices = [];
  const chrome = {runtime: {getURL: name => 'chrome-extension://offline/' + name, onMessage: {addListener() {}}}, storage: {local: {async get(keys) {return Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, clone(data[key])]));}, async set(value) {Object.assign(data, clone(value));}}}, tabs: {async create({url}) {const tab = {id: 77, url};tabs.set(77, tab);return tab;}, async get(id) {return tabs.get(id);}, onUpdated: {addListener() {}}, onRemoved: {addListener() {}}}};
  const worker = createLiepinVisibleWorker({chrome, policy, now: () => now, random: () => .1}); worker.install();
  const sender = () => ({url: href, tab: {id: owner, url: href}, documentId: 'doc-' + doc, frameId: 0});
  const dom = {show: message => notices.push(message), snapshot(batch) {
    const ambiguous = mode === 'ambiguous';
    return {href, blank: false, gate: 'ok', inputValue: ready ? batch.keyword : '', searchInput: ready && !ambiguous, searchButton: ready && !ambiguous, searchInputStatus: ambiguous ? 'ambiguous' : ready ? 'ready' : 'missing', searchButtonStatus: ambiguous ? 'ambiguous' : ready ? 'ready' : 'missing', searchDiagnostics: ambiguous ? {inputs: [{placeholder: '职位', name: 'key', tag: 'INPUT', className: 'a'}, {placeholder: '职位', name: 'key', tag: 'INPUT', className: 'b'}], buttons: []} : {inputs: [], buttons: []}, selectedCity: '', cityQuote: '', cityParam: '', cityDialog: false, cityInput: false, cityInputValue: '', otherControl: false, exactCityOption: false, jobs: [], card: null, record: null};
  }, prepare(kind, batch) {const snapshot = dom.snapshot(batch);return {snapshot, perform() {assert.equal(data[worker.keys.batch].pendingAction.kind, kind);}};}};
  const runtime = createLiepinVisibleRuntime({chrome: {runtime: {sendMessage: message => worker.dispatch(message, sender())}}, dom, href: () => href, now: () => now});
  return {data, worker, runtime, dom, notices, setReady: value => {ready = value;}, advance: ms => {now += ms;}, start: async () => {const result = await worker.dispatch({type: 'START', city: '上海', keyword: 'AI Agent'}, CONTROL);owner = result.batch.ownerTabId;return result;}, batch: () => data[worker.keys.batch]};
}

test('初始骨架只有header时保持opening，控件就绪后继续且不重复填充', async () => {
  const f = fixture(); await f.start();
  await f.runtime.tick(); assert.equal(f.batch().stage, 'opening'); assert.equal(f.batch().actions.length, 1);
  f.advance(500); await f.runtime.tick(); assert.equal(f.batch().stage, 'opening'); assert.equal(f.batch().actions.length, 1);
  f.setReady(true); await f.runtime.tick(); assert.equal(f.batch().stage, 'keyword-ready'); assert.equal(f.batch().actions.length, 1);
  f.advance(15000); await f.runtime.tick(); assert.equal(f.batch().stage, 'keyword-filled'); assert.deepEqual(f.batch().actions.map(action => action.kind), ['open-home', 'keyword-input']);
});

test('初始搜索控件持续缺失超过45秒后准确停止opening', async () => {
  const f = fixture(); await f.start(); await f.runtime.tick(); f.advance(46001); const result = await f.runtime.tick();
  assert.equal(result.halted, true); assert.equal(f.batch().status, 'stopped'); assert.match(f.batch().stopReason, /阶段 opening.*45秒/); assert.deepEqual(f.batch().actions.map(action => action.kind), ['open-home']);
});

test('搜索控件不唯一时硬停并仅保留控件最小诊断', async () => {
  const f = fixture({mode: 'ambiguous'}); await f.start(); const result = await f.runtime.tick();
  assert.equal(result.halted, true); assert.equal(f.batch().status, 'stopped'); assert.match(f.batch().stopReason, /opening搜索控件歧义/); assert.match(f.batch().stopReason, /placeholder/); assert.doesNotMatch(f.batch().stopReason, /password|账号|手机号|账户/); assert.deepEqual(f.batch().actions.map(action => action.kind), ['open-home']);
});

test('keyword-ready和keyword-filled控件等待不取得动作许可、不重复网站动作', async () => {
  const f = fixture(); await f.start(); f.setReady(true); await f.runtime.tick(); assert.equal(f.batch().stage, 'keyword-ready');
  f.setReady(false); f.advance(15000); await f.runtime.tick(); assert.equal(f.batch().stage, 'keyword-ready'); assert.deepEqual(f.batch().actions.map(action => action.kind), ['open-home']);
  f.setReady(true); await f.runtime.tick(); assert.equal(f.batch().stage, 'keyword-filled'); assert.equal(f.batch().actions.filter(action => action.kind === 'keyword-input').length, 1);
});
