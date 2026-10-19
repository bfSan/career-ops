import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createLiepinVisibleWorker} from '../../china/liepin-visible-worker.mjs';
import {createLiepinBatchPolicy} from '../../china/liepin-batch-policy.mjs';
import {envelope} from './liepin-batch-fixture.mjs';

const control = {url: 'chrome-extension://cleanup-test/control.html', frameId: 0};
const clone = value => JSON.parse(JSON.stringify(value));
function harness() {
  const payload = envelope({count: 1});
  const source = payload.batch;
  const data = {}, removed = [], events = [], onRemoved = [];
  const tabs = new Map([
    [source.ownerTabId, {id: source.ownerTabId, url: payload.records[0].url}],
    [80, {id: 80, url: 'https://www.zhipin.com/web/user/'}],
    [81, {id: 81, url: control.url}],
    [82, {id: 82, url: 'https://www.liepin.com/job/999.shtml'}],
  ]);
  const chrome = {
    runtime: {getURL: name => 'chrome-extension://cleanup-test/' + name, onMessage: {addListener() {}}},
    storage: {local: {
      async get(keys) {return clone(Object.fromEntries(keys.filter(k => data[k] !== undefined).map(k => [k, data[k]])));},
      async set(patch) {Object.assign(data, clone(patch));},
    }},
    tabs: {
      async get(id) {if (!tabs.has(id)) throw new Error('No tab with id'); return clone(tabs.get(id));},
      async remove(id) {removed.push(id);events.push('close');tabs.delete(id);for (const listener of onRemoved) listener(id);},
      async create({url}) {const tab = {id: 100, url}; tabs.set(tab.id, tab); return tab;},
      onUpdated: {addListener() {}}, onRemoved: {addListener: fn => onRemoved.push(fn)},
    },
  };
  const worker = createLiepinVisibleWorker({chrome, policy: createLiepinBatchPolicy(), now: () => Date.parse(source.exportedAt)});
  const batch = {...source, batchId: source.id, version: source.extensionVersion, stage: 'done', revision: 1,
    evidence: source.listingEvidence, jobs: source.selectedJobs, records: payload.records};
  data[worker.keys.batch] = clone(batch);
  worker.install();
  return {worker, chrome, data, tabs, removed, events, batch, getBatch: () => data[worker.keys.batch],
    export: () => worker.dispatch({type: 'AUTO_EXPORT'}, control),
    ack: (patch = {}, sender = control) => worker.dispatch({type: 'EXPORT_DISPATCHED', batchId: source.id, ...patch}, sender)};
}

test('关页必须晚于导出确认，且只关owner；重复确认、onRemoved不丢数据', async () => {
  const h = harness();
  assert.equal((await h.ack()).ok, false, '未经导出准备不得关页');
  const exported = await h.export();assert.equal(exported.ok, true);
  assert.deepEqual(h.removed, [], '准备回执不等于触发下载');
  const result = await h.ack();await h.worker.idle();
  assert.equal(result.batch.ownerCleanup.status, 'closed');
  assert.deepEqual(h.removed, [h.batch.ownerTabId]);
  for (const id of [80,81,82]) assert.equal(h.tabs.has(id), true);
  assert.equal(h.getBatch().status, 'done');assert.deepEqual(h.getBatch().records, h.batch.records);
  assert.equal((await h.ack()).ok, true);assert.equal(h.removed.length, 1);
  const manual = await h.worker.dispatch({type: 'EXPORT'}, control);
  assert.equal(manual.ok, true);assert.deepEqual(manual.receipt.records, exported.receipt.records);
});

test('错误批次、网页发送者、运行中或失败批次不得触发关页', async () => {
  const h = harness();await h.export();
  assert.equal((await h.ack({batchId: 'old-batch'})).ok, false);
  assert.equal((await h.ack({}, {url: h.batch.records[0].url, frameId: 0, tab: {id: h.batch.ownerTabId}})).ok, false);
  for (const status of ['running','stopped']) {
    h.data[h.worker.keys.batch].status = status;
    assert.equal((await h.ack()).ok, false);
  }
  assert.deepEqual(h.removed, []);
});

for (const url of ['https://www.zhipin.com/web/user/', control.url, 'https://www.liepin.com/job/999.shtml', 'https://safe.liepin.com/captcha/']) {
  test('owner已改作其他页面时不误关：' + url, async () => {
    const h = harness();await h.export();h.tabs.get(h.batch.ownerTabId).url = url;
    const result = await h.ack();assert.equal(result.batch.ownerCleanup.status, 'skipped');
    assert.deepEqual(h.removed, []);assert.equal(h.tabs.has(h.batch.ownerTabId), true);
    assert.deepEqual(h.getBatch().records, h.batch.records);
  });
}

test('owner已经关闭不误报失败，关闭API失败保留数据并可手动重导重试', async () => {
  const closed = harness();await closed.export();closed.tabs.delete(closed.batch.ownerTabId);
  assert.equal((await closed.ack()).batch.ownerCleanup.status, 'already_closed');
  assert.deepEqual(closed.removed, []);
  const h = harness();await h.export();const remove = h.chrome.tabs.remove;
  h.chrome.tabs.remove = async () => {throw new Error('temporary failure');};
  const failed = await h.ack();assert.equal(failed.batch.ownerCleanup.status, 'failed');
  assert.equal(h.tabs.has(h.batch.ownerTabId), true);assert.deepEqual(h.getBatch().records, h.batch.records);
  assert.equal((await h.worker.dispatch({type: 'EXPORT'}, control)).ok, true);
  h.chrome.tabs.remove = remove;assert.equal((await h.ack()).batch.ownerCleanup.status, 'closed');
});

test('控制页实际先触发下载再确认关页；下载抛错保留标签并可手动恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'liepin-close-control-'));
  try {
    const built = spawnSync(process.execPath, ['china/build-liepin-extension.mjs'], {
      cwd: new URL('../..', import.meta.url), env: {...process.env, CAREER_OPS_ROOT: root}, encoding: 'utf8',
    });
    assert.equal(built.status, 0, built.stderr);
    const source = readFileSync(join(root, 'data/china/extension/liepin-visible/control.js'), 'utf8');
    for (const initialFailure of [false, true]) {
      const h = harness(), elements = {}, intervals = [];
      let fail = initialFailure;
      const context = {
        document: {querySelector: selector => elements[selector] ||= {value: '', disabled: false, textContent: ''},
          createElement: () => ({click() {if (fail) throw new Error('download dispatch failed');h.events.push('download');}})},
        chrome: {runtime: {sendMessage: message => h.worker.dispatch(message, control)}},
        Blob: class {}, URL: {createObjectURL: () => 'blob:offline', revokeObjectURL() {}},
        setTimeout: () => 0, setInterval: fn => {intervals.push(fn);return 0;},
      };
      vm.runInNewContext(source, context);await new Promise(setImmediate);
      if (initialFailure) {
        assert.deepEqual(h.events, []);assert.equal(h.tabs.has(h.batch.ownerTabId), true);
        assert.match(elements['#notice'].textContent, /失败/);
        fail = false;await elements['#export'].onclick();
      }
      assert.deepEqual(h.events, ['download','close']);
      assert.equal(h.tabs.has(h.batch.ownerTabId), false);assert.equal(h.tabs.has(80), true);
      assert.deepEqual(h.getBatch().records, h.batch.records);
      for (const refresh of intervals) await refresh();
      assert.deepEqual(h.events, ['download','close'], '刷新不重复导出或关页');
    }
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '/liepin-close-control-'));
    rmSync(root, {recursive: true, force: true});
  }
});
