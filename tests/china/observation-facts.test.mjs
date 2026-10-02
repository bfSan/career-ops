import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {seed} from './fixtures/market-data.mjs';import {recordObservation} from '../../china/store.mjs';
import {parseCompensation} from '../../compensation.mjs';import {parsePostingDate} from '../../posting-dates.mjs';
import {validateObservationFacts,selectObservationFacts} from '../../china/observation-facts.mjs';
const at='2026-09-12T00:00:00.000Z';
const facts=()=>({schemaVersion:1,compensation:parseCompensation({raw:'30–50K·13薪',currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:'人民币月薪30–50K·13薪'}]}),dates:[parsePostingDate({kind:'published',raw:'今天发布',observedAt:at,timezone:'Asia/Shanghai',evidence:{field:'visibleText',quote:'今天发布'}})]});
test('facts bind successful observations without changing JD version and respect frozen cutoff',t=>{
 const root=mkdtempSync(join(tmpdir(),'facts-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {state,job}=seed(root),hash=job.latest.hash,archive=readFileSync(join(root,job.latest.capturePath));
 recordObservation(root,state,{...job.latest,platform:'boss',url:job.url,status:'ok',observedAt:at,facts:facts()});
 assert.equal(job.latest.hash,hash);assert.equal(job.versions.length,1);assert.deepEqual(readFileSync(join(root,job.latest.capturePath)),archive);
 assert.equal(selectObservationFacts(job,{contentHash:hash,observedAt:'2026-09-10T00:00:00Z'}),null);
 assert.equal(selectObservationFacts(job,{contentHash:hash,observedAt:at}).compensation.min,30000);
 const first=selectObservationFacts(job,{contentHash:hash,observedAt:at});first.compensation.min=1;
 assert.equal(selectObservationFacts(job,{contentHash:hash,observedAt:at}).compensation.min,30000);
 recordObservation(root,state,{platform:'boss',url:job.url,status:'challenge',observedAt:'2026-09-13T00:00:00Z',facts:facts()});
 assert.equal(job.lastAttempt.facts,undefined);assert.equal(job.lastSeenAt,at);
 recordObservation(root,state,{...job.latest,platform:'boss',url:job.url,status:'ok',observedAt:'2026-09-11T00:00:00Z',facts:{schemaVersion:1,compensation:null,dates:[]}});
 assert.equal(selectObservationFacts(job,{contentHash:hash,observedAt:at}).compensation.min,30000);
});
test('facts reject unknown keys, invalid values and fabricated date/numeric projections',()=>{
 assert.doesNotThrow(()=>validateObservationFacts(facts()));
 for(const change of [f=>f.extra=1,f=>f.schemaVersion=2,f=>f.compensation.min=1,f=>f.dates[0].value='2026-10-01',f=>f.dates[0].evidence=null]){
  const f=facts();change(f);assert.throws(()=>validateObservationFacts(f));
 }
});
test('historical unknown 30-payment snapshots remain readable after widening the parser',()=>{
 const c=parseCompensation({raw:'100-200k·30薪',currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:'100-200k·30薪'}]});
 const old={...c,min:null,max:null,paymentsPerYear:null,annualizedMonthly:null,advertisedAnnualCash:null,status:'unknown'};
 assert.doesNotThrow(()=>validateObservationFacts({schemaVersion:1,compensation:old,dates:[]}));
 assert.throws(()=>validateObservationFacts({schemaVersion:1,compensation:{...old,min:123},dates:[]}));
});
test('historical per-hour snapshots stay readable after the unsupported-rate guard landed',()=>{
 const c=parseCompensation({raw:'80-250元/时',currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:'80-250元/时'}]});
 assert.equal(c.status,'unknown','the guard refuses to read an hourly rate as a monthly salary');
 const legacy={...c,min:80,max:250,annualizedMonthly:{min:960,max:3000,currency:'CNY'},status:'parsed'};
 assert.doesNotThrow(()=>validateObservationFacts({schemaVersion:1,compensation:legacy,dates:[]}));
 assert.throws(()=>validateObservationFacts({schemaVersion:1,compensation:{...legacy,min:8000},dates:[]}));
 assert.throws(()=>validateObservationFacts({schemaVersion:1,compensation:{...legacy,annualizedMonthly:null},dates:[]}));
});
