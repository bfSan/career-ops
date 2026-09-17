import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {seed} from './china/fixtures/market-data.mjs';import {saveStore} from '../china/store.mjs';
import {checkPosting} from '../liveness-dispatch.mjs';
const boss='https://www.zhipin.com/job_detail/a1.html';
test('domestic disabled or challenged never reaches generic fallback; public result codes survive',async t=>{
 const dataRoot=mkdtempSync(join(tmpdir(),'dispatch-live-'));t.after(()=>rmSync(dataRoot,{recursive:true,force:true}));const f=seed(dataRoot);f.state.runs.push({searchUrl:'https://www.zhipin.com/web/geek/jobs?query=AI',seen:[f.job.key]});saveStore(dataRoot,f.state);
 const fallback=()=>assert.fail('domestic fallback');
 assert.equal((await checkPosting(boss,{domesticEnabled:false,fallback})).reason,'source_disabled');
 let closed=0;
 const challenged=await checkPosting(f.job.url,{dataRoot,domesticEnabled:true,driverFactory:async()=>({listing:async()=>({status:'ok',jobs:[{...f.job.latest,url:f.job.url}]}),detail:async()=>({status:'challenge'}),close:async()=>closed++}),fallback});
 assert.equal(challenged.result,'uncertain');assert.equal(challenged.reason,'challenge');assert.equal(closed,1);
 const publicResult=await checkPosting('https://example.com/jobs/1',{fallback:async()=>({result:'uncertain',reason:'no control',code:'no_apply_control',extra:'preserved'})});
 assert.equal(publicResult.code,'no_apply_control');assert.equal(publicResult.extra,'preserved');assert.ok(publicResult.checkedAt);
});
test('borrowed checker is not closed and malformed domestic URLs are guarded',async()=>{
 let closed=0;const checker={check:async()=>({result:'active',reason:'matched',checkedAt:'2026-09-12T00:00:00Z'}),close:async()=>closed++};
 assert.equal((await checkPosting(boss,{domesticEnabled:true,domesticChecker:checker})).result,'active');assert.equal(closed,0);
 assert.equal((await checkPosting('https://www.liepin.com/job/123.shtml',{domesticEnabled:false})).reason,'source_disabled');
 const invalid=await checkPosting('https://www.zhipin.com/web/geek/jobs',{domesticEnabled:true,fallback:()=>assert.fail('invalid domestic fallback')});
 assert.equal(invalid.code,'invalid_url');
});
