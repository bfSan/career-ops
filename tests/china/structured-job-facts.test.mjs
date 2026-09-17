import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {extractPage,buildObservationFacts} from '../../china/platforms.mjs';
const url='https://www.liepin.com/job/12345.shtml';
const desc='负责AI平台工程开发、模型评测与上线，具备扎实的软件开发经验和系统设计能力，能够独立分析生产故障并推进改进。';
const record=()=>({'@context':'https://schema.org','@type':'JobPosting',title:'AI工程师',description:desc,url,datePosted:'2026-09-08T18:03:49+08:00',validThrough:'2026-10-08T18:03:49+08:00',baseSalary:{currency:'CNY',value:{minValue:26000,maxValue:35000,unitText:'MONTH'}}});
async function fixture(t){const b=await chromium.launch({channel:'chrome',headless:true});t.after(()=>b.close());const p=await b.newPage();await p.route('**/*',r=>r.fulfill({body:'',contentType:'text/html'}));await p.goto(url);return p;}
async function extract(page,records,raw='26-35k',label=''){
 await page.setContent(`<h1>AI工程师</h1><span class="salary-label">${label}</span><span class="salary">${raw}</span><div class="job-description">${desc}</div>${records.map(r=>`<script type="application/ld+json">${JSON.stringify(r)}</script>`).join('')}`);
 const result=await page.evaluate(extractPage,{platform:'liepin',kind:'detail'});
 assert.equal(result.status,'ok');return buildObservationFacts(result.job,'2026-09-13T00:00:00Z');
}
test('identity-bound JobPosting supplies explicit pay units and precise dates to shared facts',async t=>{
 const p=await fixture(t),facts=await extract(p,[record(),{'@id':url,'@context':'https://ziyuan.baidu.com/contexts/cambrian.jsonld',upDate:'2026-09-11T17:25:10'}]);
 assert.equal(facts.compensation.status,'parsed');assert.equal(facts.compensation.currency,'CNY');assert.equal(facts.compensation.period,'month');assert.equal(facts.compensation.annualizedMonthly.min,312000);
 assert.ok(facts.compensation.evidence.some(e=>e.field==='JobPosting.baseSalary'));
 assert.equal(facts.dates.find(d=>d.kind==='published').value,'2026-09-08T10:03:49.000Z');
 assert.equal(facts.dates.find(d=>d.kind==='valid_through').value,'2026-10-08T10:03:49.000Z');
 assert.equal(facts.dates.find(d=>d.kind==='updated').value,'2026-09-11');
});
test('unrelated, stale-title or ambiguous structured jobs cannot lend units or dates',async t=>{
 const p=await fixture(t);
 for(const records of [[{...record(),url:'https://www.liepin.com/job/99999.shtml'}],[{...record(),title:'其他岗位'}],[record(),{...record(),datePosted:'2026-01-01'}]]){
  const f=await extract(p,records);assert.equal(f.compensation.status,'unknown');assert.equal(f.dates.length,0);
 }
});
test('conflicting visible and structured amounts, currency or period stay non-comparable',async t=>{
 const p=await fixture(t);
 for(const [raw,label] of [['30-50k',''],['26-35k','美元月薪'],['26-35k','人民币年薪']]){
  const f=await extract(p,[record()],raw,label);assert.equal(f.compensation.status,'unknown');
 }
});
