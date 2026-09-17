import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {loadNativeSalaryFont,normalizeSalary} from '../../china/salary.mjs';
const url='https://img.bosszhipin.com/static/file/2023/3kovsijnt11693967587313.woff2';
const job={salaryRaw:'\ue034\ue031-\ue036\ue031K',salaryFontFamily:'kanzhun-mix',salaryFontLoaded:true,salaryFontUrls:[url]};
test('native uses one loaded allowlisted font with no credentials, verified bytes and a rate-limit wait',async()=>{
 const requests=[],events=[];let waited=false;
 const fonts=await loadNativeSalaryFont(job,{wait:async()=>{waited=true;},onEvent:e=>events.push(e),fetchImpl:async(u,options)=>{
  assert.equal(waited,true);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');requests.push(u);
  return new Response(readFileSync(new URL('./fixtures/kanzhun-mix-verified.woff2',import.meta.url)));
 }});
 assert.deepEqual(requests,[url]);assert.equal(fonts[0].sha256,'37be9f6d4984819476d27d4862faa8d23181acc32bed2edafd4f42e5184cd924');
 assert.equal(normalizeSalary(job,fonts).salaryText,'30-50K');assert.equal(events[0].kind,'public_salary_font');
});
const stylesheet='https://static.zhipin.com/zhipin-geek-spa/web/v6737/static/css/app~0.7c23baca.css';
test('a document-observed stylesheet recovers a loaded font missing from resource timing',async()=>{
 const cached={...job,salaryFontUrls:[],salaryFontStylesheets:[stylesheet]};
 const css=`@font-face{font-family:kanzhun-Regular;src:url(https://evil.test/font)} @font-face{font-family:"kanzhun-mix";src:url("${url}") format("woff2")}`;
 const calls=[];let waits=0;
 const fonts=await loadNativeSalaryFont(cached,{wait:async()=>{waits++;},fetchImpl:async(u,options)=>{
  calls.push(u);assert.equal(waits,calls.length);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  return new Response(u===stylesheet?css:readFileSync(new URL('./fixtures/kanzhun-mix-verified.woff2',import.meta.url)));
 }});
 assert.deepEqual(calls,[stylesheet,url]);assert.equal(normalizeSalary(cached,fonts).salaryText,'30-50K');
 assert.equal(fonts[0].stylesheet.url,stylesheet);assert.match(fonts[0].stylesheet.sha256,/^[a-f0-9]{64}$/);
 assert.equal(normalizeSalary(cached,fonts).salaryEvidence.stylesheet.url,stylesheet);
 assert.equal(normalizeSalary({...cached,salaryFontStylesheets:[]},fonts).salaryText,undefined,'cached proof cannot cross unrelated documents');
});
test('stylesheet recovery rejects foreign URLs, wrong font faces and oversized CSS',async()=>{
 let calls=0;
 assert.deepEqual(await loadNativeSalaryFont({...job,salaryFontUrls:[],salaryFontStylesheets:['https://evil.test/app~0.css']},{fetchImpl:()=>{calls++;assert.fail('foreign stylesheet');}}),[]);
 for(const css of [`@font-face{font-family:other;src:url(${url})}`,`@font-face{font-family:kanzhun-mix;src:url(https://evil.test/font.woff2)}`,'x'.repeat(1024*1024+1)]){
  assert.deepEqual(await loadNativeSalaryFont({...job,salaryFontUrls:[],salaryFontStylesheets:[stylesheet]},{fetchImpl:async u=>{calls++;assert.equal(u,stylesheet);return new Response(css);}}),[]);
 }
 assert.equal(calls,3);
});
test('unknown/missing/oversized/redirected/failed font bytes never decode',async()=>{
 for(const fetchImpl of [async()=>new Response('wrong bytes'),async()=>new Response(new Uint8Array(32769)),async()=>new Response(null,{status:302,headers:{location:'https://example.org/font'}}),async()=>{throw new Error('network');}]){
  assert.deepEqual(await loadNativeSalaryFont(job,{fetchImpl,wait:async()=>{}}),[]);
 }
 for(const extra of [{salaryFontLoaded:false},{salaryFontUrls:[]},{salaryFontUrls:['https://evil.test/font.woff2']},{salaryFontFamily:'another'}]){
  assert.deepEqual(await loadNativeSalaryFont({...job,...extra},{fetchImpl:()=>assert.fail('unverified resource requested')}),[]);
 }
});
