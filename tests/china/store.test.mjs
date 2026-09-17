import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, saveStore, recordObservation, queueJobs } from '../../china/store.mjs';

const base = { platform:'boss',url:'https://www.zhipin.com/job_detail/aa1.html?lid=x',title:'Agent 工程师',company:'示例公司',location:'上海',salaryRaw:'30-50K·16薪',description:'负责 Agent Runtime、任务恢复、幂等、评测和运行观测。要求能够独立完成核心模块开发和验证。',status:'ok',observedAt:'2026-09-09T08:00:00.000Z' };
const temp = () => mkdtempSync(join(tmpdir(),'career-china-test-'));
test('observations preserve history and do not collapse same-company/title requisitions',()=>{
  const root=temp();
  try {
    const s=openStore(root);
    recordObservation(root,s,base);
    recordObservation(root,s,{...base,observedAt:'2026-09-10T08:00:00.000Z'});
    let job=s.jobs['boss:aa1'];
    assert.equal(job.versions.length,1); assert.equal(job.firstSeenAt,base.observedAt); assert.equal(job.lastSeenAt,'2026-09-10T08:00:00.000Z');
    recordObservation(root,s,{...base,description:base.description+'新增 RAG 经验要求。',observedAt:'2026-09-11T08:00:00.000Z'});
    assert.equal(job.versions.length,2);
    recordObservation(root,s,{...base,url:'https://www.zhipin.com/job_detail/aa2.html'});
    assert.equal(Object.keys(s.jobs).length,2);
    saveStore(root,s); assert.equal(Object.keys(openStore(root).jobs).length,2);
    assert.match(readFileSync(join(root,job.latest.capturePath),'utf8'),/新增 RAG/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('failed detail keeps complete prior content and lastSeenAt separate from last attempt',()=>{
  const root=temp();
  try {
    const s=openStore(root); recordObservation(root,s,{...base,listingText:'原始卡片\n广告',advertised:true});
    recordObservation(root,s,{platform:'boss',url:base.url,status:'login_required',observedAt:'2026-09-11T00:00:00.000Z'});
    const job=s.jobs['boss:aa1'];
    assert.equal(job.latest.description,base.description); assert.equal(job.versions.length,1);
    assert.equal(job.lastSeenAt,base.observedAt); assert.equal(job.lastAttempt.status,'login_required');
    assert.equal(job.latestListing.title,base.title); assert.equal(job.latestListing.listingText,'原始卡片\n广告');
    assert.equal(job.latestListing.advertised,true);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('queue exports complete immutable captures once, preserves pipeline and excludes unavailable jobs',async()=>{
  const root=temp();
  try {
    const s=openStore(root); recordObservation(root,s,base);
    recordObservation(root,s,{...base,url:'https://www.zhipin.com/job_detail/aa2.html',status:'closed'});
    saveStore(root,s);
    assert.equal((await queueJobs(root,{platform:'boss',limit:20})).added,1);
    assert.equal((await queueJobs(root,{platform:'boss',limit:20})).added,0);
    const pipeline=readFileSync(join(root,'data/pipeline.md'),'utf8');
    assert.match(pipeline,/local:jds\/china\/boss-aa1-/); assert.doesNotMatch(pipeline,/aa2/);
    assert.match(pipeline,/note: 薪资原文：30-50K·16薪/);
    const reference=pipeline.match(/local:(\S+)/)[1]; assert.ok(existsSync(join(root,reference)));
    assert.ok(readFileSync(join(root,reference),'utf8').includes(base.description));
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('re-queue after changed JD produces a new version and does not rewrite the first capture',async()=>{
  const root=temp();
  try {
    let s=openStore(root);recordObservation(root,s,base);saveStore(root,s);await queueJobs(root,{limit:20});
    const old=s.jobs['boss:aa1'].latest.capturePath;
    s=openStore(root);recordObservation(root,s,{...base,salaryRaw:'35-55K'});saveStore(root,s);
    assert.equal((await queueJobs(root,{limit:20})).added,1);
    assert.match(readFileSync(join(root,old),'utf8'),/30-50K/);
    assert.equal(readFileSync(join(root,'data/pipeline.md'),'utf8').match(/local:jds/g).length,2);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('backfilled observations preserve newer JD and closed status while retaining the older version',async()=>{
  const root=temp();try {
    const s=openStore(root);
    recordObservation(root,s,{...base,observedAt:'2026-09-09T08:00:00.000Z'});
    recordObservation(root,s,{...base,status:'closed',observedAt:'2026-09-10T08:00:00.000Z'});
    recordObservation(root,s,{...base,title:'旧岗位名称',description:base.description+'较早的要求。',observedAt:'2026-09-08T08:00:00.000Z'});
    const job=s.jobs['boss:aa1'];
    assert.equal(job.lastAttempt.status,'closed');assert.equal(job.latest.description,base.description);
    assert.equal(job.latestListing.title,base.title);assert.equal(job.lastSeenAt,'2026-09-09T08:00:00.000Z');
    assert.equal(job.firstSeenAt,'2026-09-08T08:00:00.000Z');assert.equal(job.versions.length,2);
    saveStore(root,s);assert.equal((await queueJobs(root)).added,0);
  }finally {rmSync(root,{recursive:true,force:true});}
});

test('explicit market queue cannot leak excluded JD or a newly changed unreviewed version',async t=>{
 const {marketSelection}=await import('../../china/market-workflow.mjs');
 const root=temp();t.after(()=>rmSync(root,{recursive:true,force:true}));const state=openStore(root);
 const one=recordObservation(root,state,base),two=recordObservation(root,state,{...base,url:'https://www.zhipin.com/job_detail/no.html',description:'负责数据中心电气暖通设备巡检、配电柜保养与设施维护。此岗位不从事任何人工智能软件研发或模型工作。'});saveStore(root,state);
 const record=j=>({jobKey:j.key,contentHash:j.latest.hash,sourceRef:{jobKey:j.key,contentHash:j.latest.hash},eligibility:{value:'eligible',scopeReview:'reviewed',evidence:[{}]},location:{targetCities:['上海'],evidence:[{}]}});
 const selection=marketSelection({configurationHash:'c',records:[record(one),{...record(two),eligibility:{value:'excluded'}}]},'c');
 assert.equal((await queueJobs(root,{market:selection})).added,1);
 assert.doesNotMatch(readFileSync(join(root,'data/pipeline.md'),'utf8'),/boss-no-/);
 const changed=openStore(root);recordObservation(root,changed,{...base,description:base.description+' 改为纯商务采购工作。'});saveStore(root,changed);
 assert.equal((await queueJobs(root,{market:selection})).added,0);
});
