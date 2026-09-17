import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {observeSalaryFonts} from '../../china/salary.mjs';
import * as salary from '../../china/platforms.mjs';
import {recordObservation,openStore} from '../../china/store.mjs';
const proof={url:'https://img.bosszhipin.com/static/file/2023/3kovsijnt11693967587313.woff2',sha256:'37be9f6d4984819476d27d4862faa8d23181acc32bed2edafd4f42e5184cd924'};

test('a known loaded salary font decodes digits while keeping verbatim raw text and provenance',()=>{
  assert.equal(typeof salary.normalizeSalary,'function');
  const raw='\ue033\ue031-\ue034\ue036K·\ue032\ue036薪';
  const job=salary.normalizeSalary({salaryRaw:raw,salaryFontFamily:'kanzhun-mix, Arial',salaryFontLoaded:true},[proof]);
  assert.equal(job.salaryRaw,raw);assert.equal(job.salaryText,'20-35K·15薪');
  assert.equal(job.salaryEvidence.sha256,proof.sha256);
  const digits=String.fromCodePoint(...Array.from({length:10},(_,i)=>0xe031+i));
  assert.equal(salary.normalizeSalary({salaryRaw:digits,salaryFontFamily:'kanzhun-mix',salaryFontLoaded:true},[proof]).salaryText,'0123456789');
});

test('unknown font versions, missing fonts and unknown glyphs never produce guessed salary text',()=>{
  assert.equal(typeof salary.normalizeSalary,'function');
  const job={salaryRaw:'\ue033\ue031-\ue034\ue036K',salaryFontFamily:'kanzhun-mix',salaryFontLoaded:true};
  for(const [input,fonts] of [[job,[]],[job,[{...proof,sha256:'0'.repeat(64)}]],[job,[{...proof,url:'https://evil.test/font.woff2'}]],[{...job,salaryFontLoaded:false},[proof]],[{...job,salaryFontFamily:'other-font, kanzhun-mix'},[proof]],[{...job,salaryRaw:'\ue999-\ue034K'},[proof]]]) {
    assert.equal(salary.normalizeSalary(input,fonts).salaryText,undefined);
  }
  assert.equal(salary.normalizeSalary({salaryRaw:'30-50K·16薪'}).salaryText,'30-50K·16薪');
  assert.equal(salary.normalizeSalary({salaryRaw:'面议'}).salaryText,'面议');
});

test('salary text and font evidence survive the real archive without rewriting its earlier version',()=>{
  assert.equal(typeof salary.normalizeSalary,'function');
  const root=mkdtempSync(join(tmpdir(),'china-salary-'));
  try {
    const state=openStore(root);const input={platform:'boss',url:'https://www.zhipin.com/job_detail/a1.html',status:'ok',title:'工程师',description:'负责生产服务开发、状态管理、故障恢复和可观测性建设。要求能够解释架构设计与结果，推进可靠性改进。',salaryRaw:'\ue033\ue031-\ue034\ue036K·\ue032\ue036薪',salaryFontFamily:'kanzhun-mix',salaryFontLoaded:true,qualityFlags:['encoded_salary']};
    const first=recordObservation(root,state,input);const oldPath=first.latest.capturePath;const oldText=readFileSync(join(root,oldPath),'utf8');
    const decoded=salary.normalizeSalary(input,[proof]);
    const result=recordObservation(root,state,decoded);
    assert.equal(result.latest.salaryRaw,input.salaryRaw);assert.equal(result.latest.salaryText,'20-35K·15薪');
    assert.equal(result.latest.salaryEvidence.sha256,proof.sha256);
    assert.equal(result.versions.length,2);assert.equal(readFileSync(join(root,oldPath),'utf8'),oldText);
    assert.match(readFileSync(join(root,result.latest.capturePath),'utf8'),/Salary \(readable\):\*\* 20-35K·15薪/);
    assert.equal(result.latestListing.salaryText,'20-35K·15薪');
    recordObservation(root,state,{...input,status:'network_error',salaryRaw:'\ue099K'});
    assert.equal(state.jobs['boss:a1'].latestListing.salaryText,undefined);
  }finally {rmSync(root,{recursive:true,force:true});}
});

test('new documents do not wait for or inherit the old document font responses',async()=>{
  const page=new EventEmitter(),frame={};page.mainFrame=()=>frame;
  const observer=observeSalaryFonts(page);let finishOld,finishNew;
  const response=body=>{const request={resourceType:()=> 'font',isNavigationRequest:()=>false};return {url:()=>proof.url,request:()=>request,body:()=>body};};
  const old=response(new Promise(resolve=>{finishOld=resolve;}));
  page.emit('request',old.request());page.emit('response',old);
  assert.equal(observer.pending(),true);
  page.emit('request',{isNavigationRequest:()=>true,frame:()=>frame});
  assert.equal(observer.pending(),false);
  const current=response(new Promise(resolve=>{finishNew=resolve;}));
  page.emit('request',current.request());page.emit('response',current);
  finishOld(Buffer.from('old synthetic font'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(observer.pending(),true);
  finishNew(Buffer.from('unknown synthetic font'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(observer.pending(),false);
  page.emit('close');
});

test('font headers arriving after navigation still belong to their original document',()=>{
  const page=new EventEmitter(),frame={};page.mainFrame=()=>frame;
  const observer=observeSalaryFonts(page);
  const oldRequest={resourceType:()=> 'font',isNavigationRequest:()=>false};
  page.emit('request',oldRequest);
  page.emit('request',{isNavigationRequest:()=>true,frame:()=>frame});
  page.emit('response',{url:()=>proof.url,request:()=>oldRequest,body:()=>new Promise(()=>{})});
  assert.equal(observer.pending(),false);
  page.emit('close');
});
test('normalizing an already verified decoded salary does not discard its proof on a second pass',()=>{
 const input={salaryRaw:'\ue035\ue031-\ue038\ue031K',salaryFontFamily:'kanzhun-mix',salaryFontLoaded:true};
 const first=salary.normalizeSalary(input,[proof]);assert.equal(salary.normalizeSalary(first).salaryText,'40-70K');
 assert.equal(salary.normalizeSalary({...first,salaryRaw:'\ue099K'}).salaryText,undefined);
});
test('an unresolved salary archive retains the observed font metadata needed for later repair',()=>{
 const root=mkdtempSync(join(tmpdir(),'salary-repair-'));try{
 const j=recordObservation(root,openStore(root),{platform:'boss',url:'https://www.zhipin.com/job_detail/font1.html',status:'ok',title:'AI开发',description:'负责生产系统研发与维护，完成架构设计、功能实现与验证，并持续优化系统的性能和稳定性。',salaryRaw:'\ue033K',salaryFontFamily:'kanzhun-mix',salaryFontLoaded:true,salaryFontUrls:[proof.url],salaryFontStylesheets:['https://static.zhipin.com/example.css']});
 assert.equal(j.latest.salaryFontFamily,'kanzhun-mix');assert.deepEqual(j.latest.salaryFontUrls,[proof.url]);assert.equal(j.latest.salaryFontLoaded,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
