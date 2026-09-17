import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {seed} from './fixtures/market-data.mjs';import {openStore,recordObservation,saveStore} from '../../china/store.mjs';
import {createDomesticChecker,checkDomesticPosting,classifyDomesticResult} from '../../china/liveness.mjs';
const search='https://www.zhipin.com/web/geek/jobs?query=AI';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'domestic-live-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=seed(root);
 for(const id of ['closed','blank'])recordObservation(root,f.state,{...f.job.latest,url:`https://www.zhipin.com/job_detail/${id}.html`,platform:'boss',status:'ok'});
 f.state.runs.push({id:'known-search',searchUrl:search,startedAt:'2026-09-12T00:00:00Z',seen:Object.keys(f.state.jobs)});saveStore(root,f.state);
 return {root,...f,cards:Object.values(f.state.jobs).map(j=>({...j.latest,url:j.url}))};
}
test('one session checks a page, records independent status history, and obeys budget/ownership',async t=>{
 const f=fixture(t),waits=[];let launches=0,closes=0;
 const checker=createDomesticChecker({dataRoot:f.root,platform:'boss',maxJobs:3,sleepImpl:async ms=>waits.push(ms),driverFactory:async()=>{
  launches++;return {listing:async()=>({status:'ok',jobs:f.cards}),detail:async card=>card.url.includes('/closed.')?{status:'closed',boundUrl:card.url,evidence:{field:'visibleText',quote:'职位已关闭'}}:card.url.includes('/blank.')?{status:'extraction_failed'}:{status:'ok',job:{...card,openEvidence:{field:'visibleControl',quote:'立即沟通'}}},close:async()=>closes++};
 }});
 const before=openStore(f.root).jobs['boss:closed'];
 const results=[];for(const card of f.cards)results.push(await checker.check(card.url));
 assert.deepEqual(results.map(r=>r.result),['active','expired','uncertain']);assert.equal(launches,1);
 assert.equal((await checker.check(f.cards[0].url)).reason,'budget_exhausted');await checker.close();assert.equal(closes,1);
 assert.deepEqual(waits,[15000,15000]);const after=openStore(f.root).jobs['boss:closed'];
 assert.equal(after.firstSeenAt,before.firstSeenAt);assert.equal(after.lastSeenAt,before.lastSeenAt);assert.equal(after.latest.hash,before.latest.hash);
 assert.equal(after.availabilityObservations.at(-1).result,'expired');assert.equal(after.availabilityObservations.at(-1).jobKey,'boss:closed');
});
test('first gate stops remaining checks and a facade never closes a borrowed checker',async t=>{
 const f=fixture(t);let details=0,closes=0;
 const checker=createDomesticChecker({dataRoot:f.root,platform:'boss',sleepImpl:async()=>{},driverFactory:async()=>({listing:async()=>({status:'ok',jobs:f.cards}),detail:async()=>{details++;return {status:'challenge'};},close:async()=>closes++})});
 assert.equal((await checkDomesticPosting(f.cards[0].url,{dataRoot:f.root,domesticChecker:checker})).reason,'challenge');
 assert.equal((await checker.check(f.cards[1].url)).reason,'challenge');assert.equal(details,1);assert.equal(closes,1);await checker.close();assert.equal(closes,1);
});
test('changed full JD gets an explicit new version, missing IDs/incorrect closures stay uncertain',async t=>{
 const f=fixture(t),old=f.job.latest.hash;
 const checker=createDomesticChecker({dataRoot:f.root,platform:'boss',sleepImpl:async()=>{},driverFactory:async()=>({listing:async()=>({status:'ok',jobs:f.cards}),detail:async card=>({status:'ok',job:{...card,description:card.description+'新增生产模型评测职责。',openEvidence:{field:'visibleControl',quote:'立即沟通'}}}),close:async()=>{}})});
 assert.equal((await checker.check(f.cards[0].url)).result,'active');await checker.close();
 const updated=openStore(f.root).jobs[f.job.key];assert.notEqual(updated.latest.hash,old);assert.equal(updated.versions.length,2);
 assert.equal(classifyDomesticResult(f.cards[0].url,'boss',{status:'closed',boundUrl:f.cards[1].url}).result,'uncertain');
 const missing=createDomesticChecker({dataRoot:f.root,platform:'boss',driverFactory:async()=>assert.fail('missing query may not launch')});
 assert.equal((await missing.check('https://www.zhipin.com/job_detail/unknown.html')).reason,'query_reference_missing');await missing.close();
});
test('liveness restores a recorded page and changes owned sessions when query references differ',async t=>{
 const f=fixture(t),state=openStore(f.root),queries=[];
 state.runs[0].cardPages=Object.fromEntries(f.cards.map((c,i)=>[`boss:${new URL(c.url).pathname.match(/([^/]+)\.html/)[1]}`,i===0?1:0]));
 state.runs.push({id:'second-query',searchUrl:search+'&city=101020100',seen:['boss:closed'],cardPages:{'boss:closed':0}});saveStore(f.root,state);
 const checker=createDomesticChecker({dataRoot:f.root,platform:'boss',sleepImpl:async()=>{},driverFactory:async()=>({listing:async(url,pageIndex)=>{queries.push([url,pageIndex]);return {status:'ok',jobs:pageIndex===1?[f.cards[0]]:[f.cards[1]]};},detail:async card=>({status:'ok',job:{...card,openEvidence:{field:'visibleControl',quote:'立即沟通'}}}),close:async()=>{}})});
 assert.equal((await checker.check(f.cards[0].url)).result,'active');assert.equal((await checker.check(f.cards[1].url)).result,'active');await checker.close();
 assert.deepEqual(queries,[[search,1],[search+'&city=101020100',0]]);
});
test('liveness page budget prevents deep restoration and absence never closes a posting',async t=>{
 const f=fixture(t),state=openStore(f.root);state.runs[0].cardPages={[f.job.key]:8};saveStore(f.root,state);
 const checker=createDomesticChecker({dataRoot:f.root,platform:'boss',maxPages:2,driverFactory:async()=>assert.fail('budget must be checked before launching')});
 const r=await checker.check(f.cards[0].url);assert.equal(r.result,'uncertain');assert.equal(r.reason,'page_budget_exhausted');await checker.close();assert.equal(openStore(f.root).jobs[f.job.key].latest.hash,f.job.latest.hash);
});
