import test from 'node:test';
import assert from 'node:assert/strict';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
import {bossEnvelope} from './boss-batch-fixture.mjs';
const p = createBossBatchPolicy();
test('BOSS schema2 policy accepts exact evidence and serialized factory', () => {
  assert.equal(p.validateReceipt(bossEnvelope()).records.length, 1);
  assert.equal(new Function('return (' + createBossBatchPolicy.toString() + ')()')().validateReceipt(bossEnvelope()).records.length, 1);
});
for (const bad of ['FDEx','AI%2BAgent','AI%2520Agent']) test('BOSS rejects wrong query '+bad, () => {
  const r=bossEnvelope();r.batch.listingEvidence.href=r.batch.listingEvidence.href.replace('AI%20Agent',bad);assert.throws(()=>p.validateReceipt(r));
});
const mutations = {
  'cross-city': r=>{r.records[0].location='福州';},
  'short-body': r=>{r.records[0].description='短正文';},
  'missing-panel-evidence': r=>{delete r.records[0].searchContext.panelEvidence;},
  'conflicting-panel': r=>{r.records[0].searchContext.panelEvidence.jobUrl='https://www.zhipin.com/job_detail/other.html';},
  'after-batch-end': r=>{r.records[0].observedAt='2026-10-20T00:10:00Z';},
  'before-list-evidence': r=>{r.batch.listingEvidence.at=r.batch.endedAt;r.records[0].observedAt='2026-10-20T00:01:20.000Z';r.records[0].searchContext.panelEvidence.at=r.records[0].observedAt;},
  'observation-too-soon': r=>{r.records[0].observedAt='2026-10-20T00:01:16.000Z';r.records[0].searchContext.panelEvidence.at=r.records[0].observedAt;},
  'unknown-capture-mode': r=>{r.records[0].searchContext.captureMode='guessed';},
  'missing-owner': r=>{delete r.batch.ownerTabId;},
  'duplicate-job': r=>{r.batch.selectedJobs.push(structuredClone(r.batch.selectedJobs[0]));r.records.push(structuredClone(r.records[0]));r.batch.recordCount=2;},
  'duplicate-query': r=>{r.batch.listingEvidence.href+='&query=AI%20Agent';},
  'duplicate-city': r=>{r.batch.listingEvidence.href+='&city=other';},
  'wrong-platform': r=>{r.kind='liepin_visible_batch';},
};
for (const [name,change] of Object.entries(mutations)) test('BOSS receipt rejects '+name,()=>{const r=bossEnvelope();change(r);assert.throws(()=>p.validateReceipt(r));});
for (const url of ['http://www.zhipin.com/job_detail/a.html','https://www.zhipin.com:444/job_detail/a.html','https://attacker.test/job_detail/a.html','https://user@www.zhipin.com/job_detail/a.html']) test('BOSS rejects unsafe job URL '+url,()=>assert.throws(()=>p.jobUrl(url)));
test('BOSS面板缺地区时只接受显式listing_card来源',()=>{
  const ok=bossEnvelope();ok.records[0].searchContext.panelEvidence.location='';ok.records[0].locationSource='listing_card';
  assert.equal(p.validateReceipt(ok).records.length,1);
  const badSource=bossEnvelope();badSource.records[0].searchContext.panelEvidence.location='';badSource.records[0].locationSource='detail_panel';
  assert.throws(()=>p.validateReceipt(badSource),/地点证据/);
  const silent=bossEnvelope();silent.records[0].searchContext.panelEvidence.location='';
  assert.throws(()=>p.validateReceipt(silent),/地点证据/,'未标注来源不得回填');
  const mismatched=bossEnvelope();mismatched.records[0].searchContext.panelEvidence.location='';mismatched.records[0].locationSource='listing_card';mismatched.records[0].location='上海·浦东新区';
  assert.throws(()=>p.validateReceipt(mismatched),/地点/);
  const fromPanel=bossEnvelope();
  assert.equal(p.validateReceipt(fromPanel).records.length,1,'详情自带地区仍正常');
});

test('BOSS schema2 policy accepts an exact FDE batch', () => {
  const r = bossEnvelope();
  r.batch.keyword = 'FDE';
  r.batch.listingEvidence.href = 'https://www.zhipin.com/web/geek/jobs?query=FDE&city=101190100';
  r.batch.listingEvidence.inputValue = 'FDE';
  for (const action of r.batch.actions) action.href = action.href.replace(/query=AI%20Agent/, 'query=FDE');
  for (const record of r.records) record.searchContext.keyword = 'FDE';
  for (const record of r.records) record.searchContext.listingHref = r.batch.listingEvidence.href;
  assert.equal(p.validateReceipt(r).records.length, 1);
});
