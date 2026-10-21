import test from 'node:test';
import assert from 'node:assert/strict';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
import {bossEnvelope} from './boss-batch-fixture.mjs';
const p = createBossBatchPolicy();
test('BOSS schema2 policy accepts exact evidence and serialized factory', () => {
  assert.equal(p.validateReceipt(bossEnvelope()).records.length, 1);
  assert.equal(new Function('return (' + createBossBatchPolicy.toString() + ')()')().validateReceipt(bossEnvelope()).records.length, 1);
});
for (const bad of ['FDE','AI%2BAgent','AI%2520Agent']) test('BOSS rejects wrong query '+bad, () => {
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
