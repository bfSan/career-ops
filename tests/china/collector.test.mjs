import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../../china/collector.mjs';
import { openStore, saveStore, recordObservation } from '../../china/store.mjs';

const url='https://www.zhipin.com/web/geek/job?query=Agent';
const card=id=>({url:`https://www.zhipin.com/job_detail/${id}.html`,title:'Agent工程师',company:'同一公司',salaryRaw:'30-50K'});
const jd='负责 Agent Runtime、任务恢复、幂等、评测和运行观测。要求能够独立完成核心模块开发和验证。';
function driver(pages,detail) {
  let index=0;
  return {listing:async(_url,page)=>{index=page;return pages[index];},next:async()=>pages[++index] || {status:'end'},detail:detail || (async()=>({status:'ok',job:{description:jd}}))};
}
const temp=()=>mkdtempSync(join(tmpdir(),'china-collect-test-'));
test('resume retries blocked detail without losing remaining cards or recollecting successful ones',async()=>{
  const root=temp();
  try {
    const pages=[{status:'ok',jobs:[card('a1'),card('a2'),card('a3')]}];
    const first=await collect({root,platform:'boss',searchUrl:url,driver:driver(pages,async c=>c.url.includes('a2')?{status:'login_required'}:{status:'ok',job:{description:jd}})});
    assert.equal(first.status,'blocked'); assert.equal(first.completed,1);
    assert.equal(openStore(root).runs[0].pending.length,2);
    const fetched=[];
    const second=await collect({root,platform:'boss',searchUrl:url,resume:true,maxPages:2,driver:driver(pages,async c=>{fetched.push(c.url);return {status:'ok',job:{description:jd}};})});
    assert.equal(second.status,'exhausted'); assert.equal(second.completed,3);
    assert.deepEqual(fetched,[card('a2').url,card('a3').url]);
    assert.equal(Object.keys(openStore(root).jobs).length,3);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('per-run limit preserves unprocessed page and resume can finish it',async()=>{
  const root=temp();
  try {
    const pages=[{status:'ok',jobs:[card('a1'),card('a2')]}];
    assert.equal((await collect({root,platform:'boss',searchUrl:url,limit:1,driver:driver(pages)})).reason,'job_limit');
    assert.equal(openStore(root).runs[0].pending[0].url,card('a2').url);
    await collect({root,platform:'boss',searchUrl:url,resume:true,maxPages:2,driver:driver(pages)});
    assert.equal(Object.keys(openStore(root).jobs).length,2);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('repeating pagination is partial, not evidence of exhausting search results',async()=>{
  const root=temp();
  try {
    const page={status:'ok',jobs:[card('a1')]};
    const result=await collect({root,platform:'boss',searchUrl:url,maxPages:3,driver:driver([page,page])});
    assert.equal(result.status,'partial'); assert.equal(result.reason,'repeated_page');
    assert.equal(result.completed,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('page-budget resume restores current page then advances without replaying its jobs',async()=>{
  const root=temp();
  try {
    const pages=[{status:'ok',jobs:[card('a1')]},{status:'ok',jobs:[card('a2')]}];
    await collect({root,platform:'boss',searchUrl:url,maxPages:1,driver:driver(pages)});
    const r=await collect({root,platform:'boss',searchUrl:url,resume:true,maxPages:2,driver:driver(pages)});
    assert.equal(r.completed,2);assert.equal(r.status,'exhausted');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('empty/challenge/extraction errors remain distinct and malformed URLs never reach detail navigation',async()=>{
  for(const status of ['empty','challenge','extraction_failed']) {
    const root=temp();
    try {const r=await collect({root,platform:'boss',searchUrl:url,driver:driver([{status,jobs:[]}])});
      assert.equal(r.status,status==='empty'?'exhausted':status==='challenge'?'blocked':'partial');
      assert.equal(r.completed,0);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
  const root=temp();
  try {const r=await collect({root,platform:'boss',searchUrl:url,driver:driver([{status:'ok',jobs:[{...card('x'),url:'https://evil.test/job_detail/x.html'}]}],async()=>assert.fail('invalid host reached detail'))});assert.equal(r.status,'partial');}
  finally{rmSync(root,{recursive:true,force:true});}
});
test('detail defaults do not erase list-side advertisement evidence',async()=>{
  const root=temp();try{
    await collect({root,platform:'boss',searchUrl:url,driver:driver([{status:'ok',jobs:[{...card('a1'),advertised:true}]}],async()=>({status:'ok',job:{description:jd,advertised:false}}))});
    assert.equal(openStore(root).jobs['boss:a1'].latest.advertised,true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('a new undecoded detail salary cannot retain the listing salary text or font evidence',async()=>{
  const root=temp();try{
    const listing={...card('a1'),salaryRaw:'\ue033\ue031K',salaryText:'20K',salaryEvidence:{method:'verified_font',sha256:'old'}};
    await collect({root,platform:'boss',searchUrl:url,driver:driver([{status:'ok',jobs:[listing]}],async()=>({status:'ok',job:{description:jd,salaryRaw:'\ue099K'}}))});
    const result=openStore(root).jobs['boss:a1'].latest;
    assert.equal(result.salaryRaw,'\ue099K');assert.equal(result.salaryText,undefined);assert.equal(result.salaryEvidence,undefined);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('resume never exhausts or advances a changed checkpoint page',async()=>{
  for(const budget of [{limit:1},{maxPages:1}]) for(const changed of [{status:'empty',jobs:[]},{status:'ok',jobs:[card('b1'),card('b2')]}]) {
    const root=temp();try{
      await collect({root,platform:'boss',searchUrl:url,...budget,driver:driver([{status:'ok',jobs:[card('a1'),card('a2')]}])});
      const pending=openStore(root).runs[0].pending.length;
      const result=await collect({root,platform:'boss',searchUrl:url,resume:true,maxPages:2,driver:driver([changed],async()=>assert.fail('changed checkpoint page must not fetch details'))});
      assert.equal(result.status,'partial');assert.equal(result.reason,'resume_page_changed');
      assert.equal(openStore(root).runs[0].pending.length,pending);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});

test('resume repairs the historical checkpoint immediately after consuming the final card',async()=>{
 const root=temp();try{
  const pages=[{status:'ok',jobs:[card('a1')]}];
  await collect({root,platform:'boss',searchUrl:url,limit:1,driver:driver(pages)});
  const state=openStore(root);state.runs[0].pageDone=false;
  // Reproduce the persisted state from an interruption between the former two saves.
  saveStore(root,state);
  const result=await collect({root,platform:'boss',searchUrl:url,resume:true,maxPages:2,driver:driver(pages,async()=>assert.fail('must not fetch completed JD'))});
  assert.equal(result.status,'exhausted');assert.equal(result.completed,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a detail challenge stops this attempt even when newer stored success remains current',async()=>{
 const root=temp();try{
  const s=openStore(root);
  recordObservation(root,s,{...card('a1'),platform:'boss',status:'ok',description:jd,observedAt:'2099-01-01T00:00:00.000Z'});saveStore(root,s);
  const result=await collect({root,platform:'boss',searchUrl:url,driver:driver([{status:'ok',jobs:[card('a1')]}],async()=>({status:'challenge'}))});
  assert.equal(result.status,'blocked');assert.equal(result.reason,'challenge');assert.equal(result.completed,0);
  assert.equal(openStore(root).runs[0].pending.length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a one-page resume budget restores the completed checkpoint and consumes at most one new page',async t=>{
 const root=temp();t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pages=[{status:'ok',jobs:[card('a1')]},{status:'ok',jobs:[card('a2')]},{status:'ok',jobs:[card('a3')]}];
 await collect({root,platform:'boss',searchUrl:url,maxPages:1,driver:driver(pages)});
 const result=await collect({root,platform:'boss',searchUrl:url,resume:true,maxPages:1,driver:driver(pages)});
 assert.equal(result.reason,'page_limit');assert.equal(result.completed,2);assert.equal(result.page,2);
 assert.equal(openStore(root).jobs['boss:a3'],undefined);
});
test('new-only collection skips globally archived IDs without consuming the detail budget and can resume',async t=>{
 const root=temp();t.after(()=>rmSync(root,{recursive:true,force:true}));
 const pages=[{status:'ok',jobs:[card('a1'),card('a2'),card('a3')]}];
 await collect({root,platform:'boss',searchUrl:url,limit:1,driver:driver(pages)});
 const reads=[];const d=()=>driver(pages,async c=>{reads.push(c.url);return {status:'ok',job:{description:jd}}});
 const first=await collect({root,platform:'boss',searchUrl:url,limit:1,skipArchived:true,driver:d()});
 assert.equal(first.captured,1);assert.deepEqual(reads,[card('a2').url]);
 await collect({root,platform:'boss',searchUrl:url,limit:1,skipArchived:true,resume:true,driver:d()});
 assert.deepEqual(reads,[card('a2').url,card('a3').url]);
});

test('a source-insufficient posting preserves evidence and does not abort remaining JDs',async()=>{
 const root=temp();try{const pages=[{status:'ok',jobs:[card('short'),card('good')]}];
 const r=await collect({root,platform:'boss',searchUrl:url,limit:5,driver:driver(pages,async c=>c.url.includes('short')?{status:'source_insufficient',reason:'short_description',job:{description:'通过应用AI帮助企业各个环节提效'}}:{status:'ok',job:{description:jd}})});
 assert.equal(r.status,'limited');assert.equal(r.completed,2);assert.equal(r.captured,1);assert.equal(r.sourceGaps.length,1);
 const j=openStore(root).jobs['boss:short'];assert.equal(j.lastAttempt.status,'source_insufficient');assert.equal(j.lastAttempt.source.description,'通过应用AI帮助企业各个环节提效');assert.equal(j.latest,undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});

 test('skipArchived holds same-version source gaps but permits changed visible evidence',async()=>{
 const root=temp();try{mkdirSync(join(root,'data/china'),{recursive:true});writeFileSync(join(root,'data/china/collection-policy.json'),JSON.stringify({schemaVersion:1,version:'test',defaultOutcome:'review',rules:[{id:'all',outcome:'collect',all:[{field:'title',pattern:'.+'}]}]}));
 let reads=0;const detail=async()=>{reads++;return{status:'source_insufficient',job:{description:'短正文'}};};
 const page={status:'ok',jobs:[card('short')]};await collect({root,platform:'boss',searchUrl:url,skipArchived:true,driver:driver([page],detail)});
 await collect({root,platform:'boss',searchUrl:url,skipArchived:true,driver:driver([page],detail)});assert.equal(reads,1);
 await collect({root,platform:'boss',searchUrl:url,skipArchived:true,driver:driver([{status:'ok',jobs:[{...card('short'),title:'AI研究工程师'}]}],detail)});assert.equal(reads,2);
 }finally{rmSync(root,{recursive:true,force:true});}
 });
