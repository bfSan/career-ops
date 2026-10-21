import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {importJobs} from '../../china/import.mjs';
import {openStore} from '../../china/store.mjs';
import {bossEnvelope} from './boss-batch-fixture.mjs';
function isolated(t){const dir=mkdtempSync(join(tmpdir(),'boss-import-'));t.after(()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+'/boss-import-'));rmSync(dir,{recursive:true,force:true});});return dir;}
test('BOSS envelope import preserves provenance and reimport is idempotent',async t=>{
  const root=isolated(t),payload=bossEnvelope();
  const result=await importJobs(root,{platform:'boss',records:payload.records,batchContext:payload});
  assert.equal(result.imported,1);assert.equal(result.observations,1);assert.equal(result.provenance.status,'validated');
  const saved=JSON.parse(readFileSync(result.receiptPath,'utf8'));assert.equal(saved.kind,'boss_visible_batch');assert.deepEqual(saved.records,payload.records);
  const job=openStore(root).jobs['boss:offline-1'];assert.equal(job.observations.length,1);assert.equal(job.observations[0].source.batchId,payload.batch.id);
  const duplicate=await importJobs(root,{platform:'boss',batchContext:payload});assert.equal(duplicate.idempotent,true);assert.equal(duplicate.observations,0);
});
test('BOSS invalid or cross-platform envelope rejects before any writes',async t=>{
  const root=isolated(t);for(const mutate of [r=>{delete r.records[0].searchContext.panelEvidence;},r=>{r.kind='liepin_visible_batch';},r=>{r.records[0].url='https://www.zhipin.com/job_detail/other.html';},r=>{r.records[0].description='登录查看完整内容';}]){
    const payload=bossEnvelope();mutate(payload);await assert.rejects(importJobs(root,{platform:'boss',batchContext:payload}));assert.deepEqual(readdirSync(root),[]);
  }
  await assert.rejects(importJobs(root,{platform:'liepin',batchContext:bossEnvelope()}));assert.deepEqual(readdirSync(root),[]);
  await assert.rejects(importJobs(root,{platform:'boss',batchContext:bossEnvelope(),records:[]}));assert.deepEqual(readdirSync(root),[]);
});
test('BOSS legacy arrays remain legacy even with copied search context',async t=>{
  const root=isolated(t);const result=await importJobs(root,{platform:'boss',records:bossEnvelope().records});assert.equal(result.provenance.status,'legacy');assert.equal(result.provenance.reason,'insufficient_search_provenance');
});
