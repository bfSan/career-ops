import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLiepinBatchPolicy} from '../../china/liepin-batch-policy.mjs';
import {createLiepinVisibleWorker} from '../../china/liepin-visible-worker.mjs';
import {createLiepinVisibleDom} from '../../china/liepin-visible-runtime.mjs';

const policy = createLiepinBatchPolicy();
const HOME = 'https://www.liepin.com/zhaopin/';
const CONTROL = {url: 'chrome-extension://test/control.html', frameId: 0};

function mockChrome() {
  const data = {};
  const tabs = new Map();
  let nextId = 100;
  const runtimeListeners = [];
  const updatedListeners = [];
  const removedListeners = [];
  const chrome = {
    runtime: {
      getURL: name => `chrome-extension://test/${name}`,
      onMessage: {addListener: fn => runtimeListeners.push(fn)},
    },
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const key of Array.isArray(keys) ? keys : Object.keys(keys || {})) result[key] = data[key];
          return result;
        },
        async set(value) { Object.assign(data, value); },
      },
    },
    tabs: {
      async create({url}) { const tab = {id: ++nextId, url}; tabs.set(tab.id, tab); return tab; },
      async get(id) { return tabs.get(id) || null; },
      async remove(id) { const existed = tabs.delete(id); if (existed) for (const fn of removedListeners) fn(id); },
      onUpdated: {addListener: fn => updatedListeners.push(fn)},
      onRemoved: {addListener: fn => removedListeners.push(fn)},
    },
    _data: data,
    _tabs: tabs,
    _runtimeListeners: runtimeListeners,
    _updatedListeners: updatedListeners,
    _removedListeners: removedListeners,
  };
  return chrome;
}

function sender(id, url, documentId = 'doc-1') {
  return {tab: {id, url}, url, documentId, frameId: 0};
}

function call(worker, message, from) {
  return worker.dispatch(message, from);
}

function clock() {
  let value = 0;
  return {now: () => value, advance: ms => {value += ms;}, value: () => value};
}

function listSnapshot({href, city, jobs = [], selected = city, cityQuote = '已选条件：' + city, inputValue = 'AI Agent'} = {}) {
  const u = new URL(href);
  return {href, blank: false, gate: 'ok', inputValue, searchInput: true, searchButton: true, selectedCity: selected, cityQuote, cityParam: u.searchParams.get('city') || '', jobs, card: null};
}

function record({batchId, city = '上海', listingHref, url, title, location = '上海徐汇'} = {}) {
  return {platform: 'liepin', url, title, company: '测试公司', location, salaryRaw: '30-50K', experience: '3-5年', education: '本科', tags: [], advertised: false, listingText: title, description: '负责生产级 AI Agent 开发、测试和部署，具备模型评估、服务监控、故障排查和完整上线经验。', complete: true, captureMethod: 'browser_extension', observedAt: new Date(60000).toISOString(), sourceText: 'visible', searchContext: {batchId, city, keyword: 'AI Agent', listingHref}};
}

test('builder output is isolated and has no startup/install navigation or automatic retries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'liepin-extension-'));
  try {
    const {spawnSync} = await import('node:child_process');
    const built = spawnSync(process.execPath, ['china/build-liepin-extension.mjs'], {cwd: new URL('../..', import.meta.url), encoding: 'utf8', env: {...process.env, CAREER_OPS_ROOT: dir}});
    assert.equal(built.status, 0, built.stderr);
    const out = new URL(`file://${dir}/data/china/extension/liepin-visible/`);
    const background = readFileSync(new URL('background.js', out), 'utf8');
    const content = readFileSync(new URL('content.js', out), 'utf8');
    assert.doesNotMatch(background, /chrome\.runtime\.(onStartup|onInstalled)/);
    assert.doesNotMatch(content, /decodeURIComponent\(|KeyboardEvent|dispatchEvent\(new MouseEvent|location\.(assign|replace)/);
    assert.match(content, /history\.back\(\)/);
    for (const file of ['background.js', 'content.js', 'control.js', 'popup.js']) {
      const checked = spawnSync(process.execPath, ['--check', new URL(file, out).pathname], {encoding: 'utf8'});
      assert.equal(checked.status, 0, `${file}: ${checked.stderr}`);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('worker rejects cross-tab actions, stale stage messages, and duplicate stage entry', async () => {
  const chrome = mockChrome(); const time = clock();
  const worker = createLiepinVisibleWorker({chrome, policy, now: time.now, random: () => 0.1});
  const started = await call(worker, {type: 'START', city: '上海', keyword: 'AI Agent'}, CONTROL);
  assert.equal(started.ok, true); const ownerId = started.batch.ownerTabId;
  const other = sender(ownerId + 1, HOME, 'other');
  assert.equal((await call(worker, {type: 'HELLO', href: HOME}, other)).owner, false);
  time.advance(15000);
  const own = sender(ownerId, HOME);
  let result = await call(worker, {type: 'HELLO', href: HOME}, own); assert.equal(result.ok, true);
  result = await call(worker, {type: 'OBSERVE', batchId: started.batch.batchId, revision: result.batch.revision, stage: result.batch.stage, href: HOME, snapshot: {href: HOME, blank: false, gate: 'ok', searchInput: true, searchButton: true, searchInputStatus: 'ready', searchButtonStatus: 'ready'}}, own);
  assert.equal(result.batch.stage, 'keyword-ready');
  const stale = await call(worker, {type: 'RESERVE', batchId: started.batch.batchId, revision: result.batch.revision - 1, stage: 'opening', href: HOME, kind: 'keyword-input', snapshot: {href: HOME, blank: false, gate: 'ok', searchInput: true}}, own);
  assert.equal(stale.stale, true);
  const reserved = await call(worker, {type: 'RESERVE', batchId: started.batch.batchId, revision: result.batch.revision, stage: 'keyword-ready', href: HOME, kind: 'keyword-input', snapshot: {href: HOME, blank: false, gate: 'ok', searchInput: true}}, own);
  assert.equal(reserved.ok, true);
  const duplicate = await call(worker, {type: 'RESERVE', batchId: started.batch.batchId, revision: reserved.batch.revision, stage: 'keyword-filled', href: HOME, kind: 'keyword-input', snapshot: {href: HOME, blank: false, gate: 'ok', searchInput: true}}, own);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /阶段锁|非法/);
  const stillRunning = (await call(worker, {type: 'CONTROL_STATE'}, CONTROL)).batch;
  assert.equal(stillRunning.status, 'running');
});

test('worker enforces shared 15-second actions and exports one successful batch with evidence/actions', async () => {
  const chrome = mockChrome(); const time = clock();
  const worker = createLiepinVisibleWorker({chrome, policy, now: time.now, random: () => 0.2});
  const start = await call(worker, {type: 'START', city: '上海', keyword: 'AI Agent'}, CONTROL);
  const ownerId = start.batch.ownerTabId, batchId = start.batch.batchId;
  let doc = 'd1', href = HOME;
  const own = () => sender(ownerId, href, doc);
  time.advance(15000);
  let r = await call(worker, {type: 'HELLO', href}, own());
  r = await call(worker, {type: 'OBSERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, snapshot: {href, blank: false, gate: 'ok', searchInput: true, searchButton: true, searchInputStatus: 'ready', searchButtonStatus: 'ready'}}, own());
  time.advance(15000);
  r = await call(worker, {type: 'RESERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, kind: 'keyword-input', snapshot: {href, blank: false, gate: 'ok', searchInput: true, searchButton: true, searchInputStatus: 'ready', searchButtonStatus: 'ready'}}, own());
  assert.equal(r.ok, true);
  time.advance(15000);
  r = await call(worker, {type: 'RESERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, kind: 'search', snapshot: {href, blank: false, gate: 'ok', inputValue: 'AI Agent', searchButton: true}}, own());
  assert.equal(r.ok, true);
  href = 'https://www.liepin.com/zhaopin/?key=AI%20Agent'; doc = 'd2'; chrome._tabs.get(ownerId).url = href;
  const spaSender = {tab: {id: ownerId, url: href}, url: HOME, documentId: doc, frameId: 0};
  r = await call(worker, {type: 'HELLO', href}, spaSender); assert.equal(r.ok, true);
  r = await call(worker, {type: 'OBSERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, snapshot: listSnapshot({href, city: '上海', selected: '', cityQuote: ''})}, spaSender); assert.equal(r.batch.stage, 'city-ready');
  time.advance(15000);
  r = await call(worker, {type: 'RESERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, kind: 'city-select', snapshot: {...listSnapshot({href, city: '上海', selected: '', cityQuote: ''}), exactCityOption: true}}, own()); assert.equal(r.ok, true);
  href = 'https://www.liepin.com/zhaopin/?key=AI%20Agent&city=310100'; doc = 'd3'; chrome._tabs.get(ownerId).url = href;
  r = await call(worker, {type: 'HELLO', href}, own()); assert.equal(r.ok, true);
  const jobs = [{url: 'https://www.liepin.com/job/101.shtml?pgRef=x', title: 'AI平台工程师', location: '上海徐汇', company: '测试公司'}];
  r = await call(worker, {type: 'OBSERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, snapshot: listSnapshot({href, city: '上海', jobs, selected: '上海'})}, own()); assert.equal(r.batch.stage, 'listing-ready');
  r = await call(worker, {type: 'OBSERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, snapshot: listSnapshot({href, city: '上海', jobs, selected: '上海'})}, own()); assert.equal(r.batch.stage, 'job-ready');
  time.advance(15000);
  r = await call(worker, {type: 'RESERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, kind: 'job-click', jobUrl: jobs[0].url, snapshot: {...listSnapshot({href, city: '上海', jobs, selected: '上海'}), card: jobs[0]}}, own()); assert.equal(r.ok, true);
  href = 'https://www.liepin.com/job/101.shtml'; doc = 'd4'; chrome._tabs.get(ownerId).url = href;
  r = await call(worker, {type: 'HELLO', href}, own()); assert.equal(r.ok, true);
  const rec = record({batchId, listingHref: 'https://www.liepin.com/zhaopin/?key=AI%20Agent&city=310100', url: href, title: jobs[0].title});
  rec.observedAt = new Date(time.value()).toISOString();
  r = await call(worker, {type: 'OBSERVE', batchId, revision: r.batch.revision, stage: r.batch.stage, href, snapshot: {href, blank: false, gate: 'ok', record: rec}}, own()); assert.equal(r.batch.status, 'done');
  const exported = await call(worker, {type: 'EXPORT'}, CONTROL);
  assert.equal(exported.ok, true, exported.message);
  assert.equal(exported.receipt.schemaVersion, 2); assert.equal(exported.receipt.kind, 'liepin_visible_batch');
  assert.equal(exported.receipt.records.length, 1); assert.equal(exported.receipt.batch.actions.some(a => a.kind === 'search'), true); assert.equal(exported.receipt.batch.actions.some(a => a.kind === 'job-click'), true);
  for (let i = 1; i < exported.receipt.batch.actions.length; i++) assert.ok(Date.parse(exported.receipt.batch.actions[i].at) - Date.parse(exported.receipt.batch.actions[i - 1].at) >= 15000);
  assert.equal(chrome._tabs.has(ownerId), true, '导出确认前不关闭owner标签');
  const auto = await call(worker, {type: 'AUTO_EXPORT'}, CONTROL); assert.equal(auto.ok, true);
  const dispatched = await call(worker, {type: 'EXPORT_DISPATCHED', batchId}, CONTROL);
  assert.equal(dispatched.ok, true); assert.equal(dispatched.batch.ownerCleanup.status, 'closed');
  assert.equal(chrome._tabs.has(ownerId), false, '确认下载后只关闭本批owner标签');
});

test('DOM adapter requires exact 福州 flow and native value events, without synthetic click/Enter retry', () => {
  const events = [], clicks = [];
  const queryInput = {tagName: 'INPUT', type: 'text', value: 'AI Agent', placeholder: '', isConnected: true, getClientRects: () => [{}], parentElement: null, closest: () => null, dispatchEvent: e => events.push(e.type), getAttribute: n => n === 'name' ? 'key' : null};
  const input = {tagName: 'INPUT', type: 'text', value: '', placeholder: '搜索城市', isConnected: true, getClientRects: () => [{}], parentElement: null, closest: () => null, dispatchEvent: e => events.push(e.type), getAttribute: n => n === 'placeholder' ? '搜索城市' : null};
  const option = {tagName: 'DIV', innerText: '福州', isConnected: true, getClientRects: () => [{}], children: [], contains: () => false, click: () => clicks.push('福州'), getAttribute: () => null, parentElement: null};
  const other = {tagName: 'DIV', innerText: '其他', isConnected: true, getClientRects: () => [{}], children: [], contains: () => false, click: () => clicks.push('其他'), getAttribute: () => null, parentElement: null};
  const dialog = {innerText: '请选择城市 搜索城市 福州', isConnected: true, getClientRects: () => [{}], querySelectorAll: selector => selector === 'input[placeholder="搜索城市"]' ? [input] : [option], parentElement: null};
  input.parentElement = dialog;
  const body = {innerText: '城市 全国 上海 其他'};
  const document = {body, documentElement: {append: () => {}}, querySelectorAll: selector => selector.includes('dialog') ? [dialog] : selector.includes('搜索城市') ? [input] : selector === 'input[name="key"]' ? [queryInput] : selector.startsWith('input') ? [] : selector.includes('其他') ? [other] : [other], createElement: () => ({style: {}, attachShadow: () => ({append: () => {}}), append: () => {}})};
  const window = {getComputedStyle: () => ({visibility: 'visible', display: 'block'}), HTMLInputElement: {prototype: {}}, Event: class {constructor(type) {this.type = type;}}};
  Object.defineProperty(window.HTMLInputElement.prototype, 'value', {set(v) {this.value = v;}, configurable: true});
  const location = {href: 'https://www.liepin.com/zhaopin/?key=AI%20Agent', pathname: '/zhaopin/'};
  const dom = createLiepinVisibleDom({window, document, location, history: {back: () => {}}, extractPage: () => ({status: 'ok', jobs: []}), policy});
  const batch = {batchId: 'b', city: '福州', keyword: 'AI Agent', jobs: [], records: []};
  const prepared = dom.prepare('city-input', batch);
  prepared.perform();
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(input.value, '福州');
  assert.deepEqual(clicks, []);
  assert.doesNotMatch(createLiepinVisibleDom.toString(), /KeyboardEvent|dispatchEvent\(new MouseEvent/);
});
