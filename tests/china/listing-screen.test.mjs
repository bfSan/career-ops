import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {collect} from '../../china/collector.mjs';import {openStore} from '../../china/store.mjs';
import {createListingScreen} from '../../china/listing-screen.mjs';
const policy={schemaVersion:1,version:'fixture-ai-four-city',rules:[{id:'sales',outcome:'exclude',all:[{field:'title',pattern:'销售经理'}]},{id:'outside',outcome:'exclude',all:[{field:'location',pattern:'^北京'}]},{id:'technical-in-city',outcome:'collect',all:[{field:'location',pattern:'^(上海|杭州|南京|福州)'},{field:'title',pattern:'算法|Agent|推理|研发'}]}],defaultOutcome:'review'};
const cards=[['101','AI销售经理','上海'],['102','推理工程师','北京'],['103','AI负责人','上海'],['104','Agent研发工程师','上海'],['105','算法工程师','杭州']].map(([id,title,location])=>({url:`https://www.liepin.com/job/${id}.shtml`,title,location,company:'合成公司',listingText:id==='105'?'猎头顾问':''}));
const url='https://www.liepin.com/zhaopin/?city=020&key=Agent';
test('unmatched policy is reported as a rule gap, not a claim that source evidence is insufficient',()=>{
 const result=createListingScreen(policy)({title:'Backend Engineer, AI',location:'上海'});
 assert.equal(result.outcome,'review');assert.equal(result.rule,'no_policy_rule_matched');
 assert.deepEqual(result.evidence,[]);
});
function setup(t){const root=mkdtempSync(join(tmpdir(),'listing-screen-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'data/china'),{recursive:true});const p=join(root,'data/china/collection-policy.json');writeFileSync(p,JSON.stringify(policy));const reads=[];const driver={listing:async()=>({status:'ok',url,jobs:cards}),detail:async card=>{reads.push(card.title);return {status:'ok',job:{...card,description:'负责AI系统研发、推理服务优化与算法实现，完成真实业务上线及性能验证，要求扎实编程能力和工程协作经验。'}}},next:async()=>({status:'end'})};return{root,p,reads,driver};}
test('configured listing screening never reads excluded or unreviewed cards, and does not exclude headhunters',async t=>{const f=setup(t),r=await collect({...f,platform:'liepin',searchUrl:url,limit:5});assert.deepEqual(f.reads,['Agent研发工程师','算法工程师']);assert.equal(r.captured,2);const s=openStore(f.root);assert.equal(Object.keys(s.jobs).length,2);assert.equal(s.runs[0].screened.filter(x=>x.outcome==='exclude').length,2);assert.equal(s.runs[0].screened.filter(x=>x.outcome==='review').length,1);assert.equal(s.runs[0].pageSignatures.length,1);});
test('resuming a screened page keeps the full page signature and does not revisit excluded cards',async t=>{const f=setup(t);await collect({...f,platform:'liepin',searchUrl:url,limit:1});const r=await collect({...f,platform:'liepin',searchUrl:url,limit:1,resume:true});assert.equal(r.captured,2);assert.deepEqual(f.reads,['Agent研发工程师','算法工程师']);});
test('invalid collection policy fails before opening the listing or reading any JD',async t=>{const f=setup(t);writeFileSync(f.p,JSON.stringify({...policy,rules:[{id:'bad',outcome:'collect',all:[{field:'title',pattern:'['}]}]}));let opened=false;f.driver.listing=async()=>{opened=true;return{status:'empty'}};await assert.rejects(collect({...f,platform:'liepin',searchUrl:url}),/policy|pattern|regular expression/i);assert.equal(opened,false);assert.equal(f.reads.length,0);});
test('the whole observed page is screened before the JD budget stops, so pending contains only collectable cards',async t=>{const f=setup(t);f.driver.listing=async()=>({status:'ok',url,jobs:[cards[3],cards[4],cards[0],cards[1],cards[2]]});const r=await collect({...f,platform:'liepin',searchUrl:url,limit:1});assert.equal(r.pending,1);assert.equal(openStore(f.root).runs[0].screened.length,5);});
test('withheld list entries retain the original card for review without creating a JD',async t=>{const f=setup(t);await collect({...f,platform:'liepin',searchUrl:url,limit:5});const state=openStore(f.root),row=state.runs[0].screened.find(r=>r.outcome==='review');assert.equal(row.card?.title,'AI负责人');assert.equal(row.card?.location,'上海');assert(!state.jobs['liepin:job-103']);});
test('resume screens the fresh listing location rather than a stale pending card',async t=>{const f=setup(t);await collect({...f,platform:'liepin',searchUrl:url,limit:1});f.driver.listing=async()=>({status:'ok',url,jobs:cards.map(c=>c.url.endsWith('/105.shtml')?{...c,location:'北京'}:c)});const r=await collect({...f,platform:'liepin',searchUrl:url,limit:1,resume:true});assert.equal(r.captured,1);assert.deepEqual(f.reads,['Agent研发工程师']);});

test('adding a policy cannot resume an older unscreened run or label its captures as screened',async t=>{
 const f=setup(t);rmSync(f.p);await collect({...f,platform:'liepin',searchUrl:url,limit:1});
 writeFileSync(f.p,JSON.stringify(policy));let opened=false;
 f.driver.listing=async()=>{opened=true;return {status:'ok',url,jobs:cards}};
 await assert.rejects(collect({...f,platform:'liepin',searchUrl:url,limit:1,resume:true}),/policy changed/i);
 assert.equal(opened,false);assert.equal(openStore(f.root).runs[0].screeningPolicyDigest,undefined);
});

for(const initialLimit of [1,5])test(`resume rechecks held cards against fresh evidence after a ${initialLimit}-JD budget`,async t=>{
 const f=setup(t);await collect({...f,platform:'liepin',searchUrl:url,limit:initialLimit});
 f.driver.listing=async()=>({status:'ok',url,jobs:cards.map(c=>c.url.endsWith('/103.shtml')?{...c,title:'AI算法研发负责人'}:c)});
 await collect({...f,platform:'liepin',searchUrl:url,limit:5,resume:true});
 const state=openStore(f.root),decision=state.runs[0].screened.find(r=>r.key==='liepin:job-103');
 assert.equal(decision.outcome,'collect');assert.equal(decision.card.title,'AI算法研发负责人');
 assert.equal(state.jobs['liepin:job-103'].latest.title,'AI算法研发负责人');
 assert.equal(f.reads.filter(x=>x==='AI算法研发负责人').length,1);
 assert.equal(f.reads.filter(x=>x==='Agent研发工程师').length,1);
});

test('source-specific reviewed exclusion does not suppress a different posting or changed title',async t=>{
 const f=setup(t);const targeted={...policy,rules:[{id:'reviewed-source',outcome:'exclude',all:[{field:'key',pattern:'^liepin:job-104$'},{field:'title',pattern:'^Agent研发工程师$'},{field:'company',pattern:'^合成公司$'}]},...policy.rules]};
 writeFileSync(f.p,JSON.stringify(targeted));await collect({...f,platform:'liepin',searchUrl:url,limit:5});assert.deepEqual(f.reads,['算法工程师']);
 const screen=createListingScreen(targeted);
 assert.equal(screen({...cards[3],key:'liepin:job-999'}).outcome,'collect');
 assert.equal(screen({...cards[3],key:'liepin:job-104',title:'AI算法研发负责人'}).outcome,'collect');
});

test('market acquisition consumes only approved identities with unchanged visible facts',async t=>{
 const {listingVersion}=await import('../../china/market-workflow.mjs');const f=setup(t),screen=createListingScreen(policy),card={...cards[3],key:'liepin:job-104'};
 const marketPlan={policyDigest:screen.policyDigest,records:[{key:card.key,listingVersion:listingVersion(card),state:'ready'}]};
 await collect({...f,platform:'liepin',searchUrl:url,limit:5,marketPlan});assert.deepEqual(f.reads,['Agent研发工程师']);
 f.reads.length=0;f.driver.listing=async()=>({status:'ok',url,jobs:[{...cards[3],title:'AI算法研发负责人'}]});
 await collect({...f,platform:'liepin',searchUrl:url,limit:5,marketPlan});assert.deepEqual(f.reads,[]);
});
test('market acquisition rejects missing policy or stale approval before browser startup',async t=>{
 const f=setup(t);let opened=false;f.driver.listing=async()=>{opened=true;return{status:'empty'}};
 await assert.rejects(collect({...f,platform:'liepin',searchUrl:url,marketPlan:{policyDigest:'old',records:[]}}),/policy/);
 rmSync(f.p);await assert.rejects(collect({...f,platform:'liepin',searchUrl:url,marketPlan:{policyDigest:'old',records:[]}}),/policy/);assert.equal(opened,false);
});
test('market capture persists a source-bound scope task even when the next detail is login-blocked',async t=>{
 const {listingVersion}=await import('../../china/market-workflow.mjs');const f=setup(t),screen=createListingScreen(policy),keys=['liepin:job-104','liepin:job-105'];
 const marketPlan={policyDigest:screen.policyDigest,records:cards.slice(3).map((c,i)=>({key:keys[i],listingVersion:listingVersion({...c,key:keys[i]}),state:'ready'}))};
 const read=f.driver.detail;f.driver.detail=async c=>c.key===keys[1]?{status:'login_required'}:read(c);
 const result=await collect({...f,platform:'liepin',searchUrl:url,marketPlan});assert.equal(result.status,'blocked');
 const state=openStore(f.root),tasks=state.runs[0].followupTasks;assert.equal(tasks.length,1);assert.equal(tasks[0].state,'pending_scope_review');assert.equal(tasks[0].contentHash,state.jobs[keys[0]].latest.hash);assert.equal(result.followupTasks.length,1);
});
