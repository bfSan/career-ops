import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {verifyOffers} from '../../scan.mjs';import {scanFixture} from './fixtures/provider-scan.mjs';
test('actual verifyOffers preserves public buckets and shares domestic routing',async()=>{
 const offers=[{url:'https://www.zhipin.com/job_detail/a1.html',title:'A',company:'甲'},...['active','gone','guard','noapply'].map(id=>({url:`https://example.com/${id}`,title:id,company:'B'}))];
 const result=await verifyOffers(offers,{domesticEnabled:false,fallback:async url=>url.endsWith('gone')?{result:'expired',reason:'gone',code:'http_gone'}:url.endsWith('guard')?{result:'uncertain',reason:'guard',code:'blocked_host'}:url.endsWith('noapply')?{result:'uncertain',reason:'missing',code:'no_apply_control'}:{result:'active',reason:'OK'}});
 assert.deepEqual(result.verified.map(j=>j.title),['A','active']);assert.equal(result.expired.length,1);assert.equal(result.invalid.length,1);assert.equal(result.dropped.length,1);
});
test('real check-liveness child CLI reports disabled domestic sources without a browser',t=>{
 const root=mkdtempSync(join(tmpdir(),'liveness-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {codeRoot}=scanFixture(t,root);
 const run=spawnSync(process.execPath,[join(codeRoot,'check-liveness.mjs'),'https://www.liepin.com/job/12345.shtml'],{cwd:codeRoot,env:{...process.env,CAREER_OPS_ROOT:root},encoding:'utf8',timeout:10000});
 assert.equal(run.status,1,run.stderr);assert.match(run.stdout,/source_disabled/);assert.match(run.stdout,/0 active\s+0 expired\s+1 uncertain/);
});
test('actual verifyOffers reuses one domestic session across jobs and closes it once',async t=>{
 const {seed}=await import('./fixtures/market-data.mjs');const {recordObservation,saveStore}=await import('../../china/store.mjs');
 const root=mkdtempSync(join(tmpdir(),'verify-batch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=seed(root);
 recordObservation(root,f.state,{...f.job.latest,platform:'boss',status:'ok',url:'https://www.zhipin.com/job_detail/second.html'});
 const cards=Object.values(f.state.jobs).map(j=>({...j.latest,url:j.url}));
 f.state.runs.push({searchUrl:'https://www.zhipin.com/web/geek/jobs?query=AI',seen:Object.keys(f.state.jobs)});saveStore(root,f.state);
 let launches=0,closes=0;
 const result=await verifyOffers(cards,{dataRoot:root,domesticEnabled:true,domesticSleep:async()=>{},driverFactory:async()=>{
 launches++;return {listing:async()=>({status:'ok',jobs:cards}),detail:async card=>({status:'ok',job:{...card,openEvidence:{field:'visibleControl',quote:'立即沟通'}}}),close:async()=>closes++};}});
 assert.equal(result.verified.length,2);assert.equal(launches,1);assert.equal(closes,1);
});
