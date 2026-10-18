import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createLiepinBatchPolicy, liepinBatchPolicy as policy } from '../../china/liepin-batch-policy.mjs';

const at = seconds => new Date(Date.UTC(2026, 9, 18, 0, 0, seconds)).toISOString();
export function envelope({ city = '上海', keyword = 'AI Agent', count = 2, id = 'offline-batch' } = {}) {
  const href = `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(keyword)}&city=opaque-city`;
  const selectedJobs = Array.from({ length: count }, (_, i) => ({ url: `https://www.liepin.com/job/${100 + i}.shtml`, title: `${keyword} 工程师 ${i}`, location: city }));
  const records = selectedJobs.map((job, i) => ({ ...job, company: '离线测试公司', description: '负责生产级 Agent 平台开发、部署、工具调用、状态管理、测试评估与可观测系统建设，要求解释架构决策和故障恢复流程。', complete: true, captureMethod: 'browser_extension', observedAt: at(31 + i * 30), searchContext: { batchId: id, city, keyword, listingHref: href } }));
  return { schemaVersion: 2, kind: 'liepin_visible_batch', batch: { id, ownerTabId: 7, extensionVersion: '0.5.0', city, keyword, startedAt: at(0), endedAt: at(90), status: 'done', stopReason: null, recordCount: count, selectedJobs, listingEvidence: { href, inputValue: keyword, selectedCity: city, at: at(16) }, actions: [{ kind: 'search', href, at: at(0) }, ...selectedJobs.map((job, i) => ({ kind: 'job-click', href, jobUrl: job.url, at: at(30 + i * 30) }))], maxJobs: 2, minIntervalMs: 15000, exportedAt: at(91) }, records };
}
const mutated = fn => { const value = envelope(); fn(value); return value; };

test('factory API survives toString serialization and accepts all four cities and two keywords', () => {
  const serialized = vm.runInNewContext(`(${createLiepinBatchPolicy.toString()})()`, { URL, URLSearchParams });
  assert.deepEqual(Object.keys(serialized), ['cities', 'keywords', 'intervalMs', 'normalize', 'config', 'listingEvidence', 'jobUrl', 'validateRecord', 'receipt', 'validateReceipt']);
  for (const city of policy.cities) for (const keyword of policy.keywords) for (const count of [1, 2]) {
    const value = envelope({ city, keyword, count });
    assert.equal(policy.validateReceipt(value), value);
    assert.equal(serialized.validateReceipt(value), value);
  }
  const value = envelope();
  const b = value.batch;
  assert.deepEqual(policy.receipt({ ...b, version: b.extensionVersion, jobs: b.selectedJobs, evidence: b.listingEvidence, records: value.records }, b.exportedAt).records, value.records);
});

test('URLSearchParams is decoded once; encoded literal plus and double escapes cannot become AI Agent', () => {
  const e = envelope().batch.listingEvidence;
  for (const query of ['AI%20Agent', 'AI+Agent']) assert.doesNotThrow(() => policy.listingEvidence({ ...e, href: `https://www.liepin.com/zhaopin/?key=${query}&city=1` }, { city: '上海', keyword: 'AI Agent' }));
  for (const query of ['AI%2BAgent', 'AI%2520Agent', 'AI%20%20Agent', 'fde']) assert.throws(() => policy.listingEvidence({ ...e, href: `https://www.liepin.com/zhaopin/?key=${query}&city=1` }, { city: '上海', keyword: 'AI Agent' }));
  for (const patch of [{ inputValue: ' AI Agent' }, { inputValue: 'AI  Agent' }, { selectedCity: '上海 ' }, { selectedCity: '杭州' }, { href: 'https://www.liepin.com/zhaopin/?key=AI%20Agent' }]) assert.throws(() => policy.listingEvidence({ ...e, ...patch }, { city: '上海', keyword: 'AI Agent' }));
});

test('listing and detail URLs require HTTPS, recognized hosts and no credentials or custom port', () => {
  const e = envelope().batch.listingEvidence;
  for (const href of ['http://www.liepin.com/zhaopin/?key=AI%20Agent&city=1', 'https://user@www.liepin.com/zhaopin/?key=AI%20Agent&city=1', 'https://www.liepin.com:8443/zhaopin/?key=AI%20Agent&city=1', 'https://evil.test/zhaopin/?key=AI%20Agent&city=1']) assert.throws(() => policy.listingEvidence({ ...e, href }, { city: '上海', keyword: 'AI Agent' }));
  for (const url of ['http://www.liepin.com/job/1.shtml', 'https://user@www.liepin.com/job/1.shtml', 'https://www.liepin.com:8443/job/1.shtml', 'https://evil.test/job/1.shtml']) assert.throws(() => policy.jobUrl(url));
  assert.equal(policy.jobUrl('https://c.liepin.com:443/job/1.shtml?tracking=1'), 'https://www.liepin.com/job/1.shtml');
});

test('rejects cross-city/query identity, mixed records, fake batch, wrong budget and non-done/empty receipts', () => {
  const bad = [
    v => { v.schemaVersion = 1; }, v => { v.kind = 'fake'; }, v => { v.batch.status = 'running'; }, v => { v.batch.stopReason = 'challenge'; },
    v => { v.batch.city = '北京'; }, v => { v.batch.keyword = 'Agent'; }, v => { v.batch.maxJobs = 100; }, v => { v.batch.minIntervalMs = 1; },
    v => { v.records[0].location = '杭州'; }, v => { v.records[0].title = '错岗位'; }, v => { v.records[0].url = v.records[1].url; },
    v => { v.records[0].searchContext.city = '杭州'; }, v => { v.records[0].searchContext.keyword = 'FDE'; }, v => { v.records[0].searchContext.batchId = 'other'; },
    v => { v.records[0].searchContext.listingHref += '&page=2'; }, v => { v.batch.selectedJobs[0].location = '杭州'; },
    v => { v.records.push(...v.records); }, v => { v.batch.selectedJobs = []; }, v => { v.batch.recordCount = 1; },
    v => { v.records = []; v.batch.recordCount = 0; v.batch.selectedJobs = []; },
  ];
  for (const patch of bad) assert.throws(() => policy.validateReceipt(mutated(patch)));
  assert.throws(() => policy.validateReceipt(envelope().batch));
  assert.throws(() => policy.validateReceipt(envelope().records));
});

test('validates 15s actions/observations, batch chronology and corresponding job-click', () => {
  const bad = [
    v => { v.batch.actions[1].at = at(14); }, v => { v.records[1].observedAt = at(45); },
    v => { v.batch.actions = v.batch.actions.filter(a => a.kind !== 'search'); }, v => { v.batch.actions[1].jobUrl = 'https://www.liepin.com/job/999.shtml'; },
    v => { v.batch.actions[1].at = at(45); }, v => { v.records[0].observedAt = at(-1); },
    v => { v.records[1].observedAt = at(100); }, v => { v.batch.endedAt = at(-1); }, v => { v.batch.exportedAt = at(80); },
    v => { v.batch.listingEvidence.at = at(100); }, v => { v.batch.actions[0].href = 'https://evil.test'; },
  ];
  for (const patch of bad) assert.throws(() => policy.validateReceipt(mutated(patch)));
  const alternateVersion = envelope(); delete alternateVersion.batch.extensionVersion; alternateVersion.batch.version = '0.5.0';
  assert.doesNotThrow(() => policy.validateReceipt(alternateVersion));
  alternateVersion.batch.extensionVersion = 'conflict'; assert.throws(() => policy.validateReceipt(alternateVersion));
});
