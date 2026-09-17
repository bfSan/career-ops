import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {extractPage} from '../../china/platforms.mjs';
import {collect} from '../../china/collector.mjs';
import {openStore} from '../../china/store.mjs';
const description='负责AI平台工程开发、模型评测与上线。需要能够独立分析生产故障和推进改进。项目团队100人以上，平台服务10000人以上。';
test('company employee size follows the selected company through collector and archive',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
 const root=mkdtempSync(join(tmpdir(),'company-size-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const platform of ['boss','liepin']){
  const page=await browser.newPage();
  const url=platform==='boss'?'https://www.zhipin.com/job_detail/size1.html':'https://www.liepin.com/job/12345.shtml';
  const company=platform==='boss'?'<div class="company-tag-list"><li>互联网</li><li>100-499人</li></div>':'<div class="company-info-container"><div class="company-card"><div class="content"><div class="name">实际公司</div><ul><li>融资未公开</li><li>100-499人</li></ul></div></div></div>';
  await page.setContent(`<div class="${platform==='boss'?'job-detail-container':'job-apply-container'}"><h1>AI工程师</h1><span class="salary">30-50K</span>${platform==='boss'?company:''}<div class="${platform==='boss'?'job-sec-text':'job-description'}">${description}</div></div>${platform==='liepin'?company:''}<div class="love-job-container"><div class="company-tag-list"><li>10000人以上</li></div></div>`);
  const detail=await page.evaluate(extractPage,{platform,kind:'detail'});
  assert.equal(detail.status,'ok');assert.equal(detail.job.companySizeRaw,'100-499人');
  assert.equal(detail.job.companySizeEvidence.quote,'100-499人');
  const driver={listing:async()=>({status:'ok',jobs:[{url,title:'AI工程师'}]}),detail:async()=>detail,next:async()=>({status:'end'})};
  await collect({root,platform,searchUrl:platform==='boss'?'https://www.zhipin.com/web/geek/jobs?query=AI':'https://www.liepin.com/zhaopin/?key=AI',limit:1,driver});
  const stored=Object.values(openStore(root).jobs).find(j=>j.platform===platform);
  assert.equal(stored.latest.companySizeRaw,'100-499人');assert.equal(stored.latestListing.companySizeRaw,'100-499人');
  assert.deepEqual(stored.latest.companySizeEvidence,detail.job.companySizeEvidence);
  assert.match(readFileSync(join(root,stored.latest.capturePath),'utf8'),/Company size.*100-499人/);
  await page.setContent(`<h1>AI工程师</h1><div class="${platform==='boss'?'job-sec-text':'job-description'}">${description}</div><div class="love-job-container"><div class="company-tag-list"><li>10000人以上</li></div></div>`);
  assert.equal((await page.evaluate(extractPage,{platform,kind:'detail'})).job.companySizeRaw,undefined);
  await page.close();
 }
});
test('listing preserves size labels and stylesheet hrefs without reading cross-origin CSS rules',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const css='https://static.zhipin.com/zhipin-geek-spa/web/v6737/static/css/app~0.7c23baca.css';
 await page.route('**/*',route=>route.fulfill({body:'body{color:black}',contentType:'text/css'}));
 await page.goto('https://www.zhipin.com/web/geek/jobs?query=AI');
  await page.setContent(`<link rel="stylesheet" href="${css}"><div class="job-card-wrapper"><a class="job-name" href="https://www.zhipin.com/job_detail/size1.html">AI工程师</a><ul class="company-tag-list"><li>20-99人</li></ul><ul class="tag-list"><li>在校/应届</li></ul></div>`);
 const result=await page.evaluate(extractPage,{platform:'boss',kind:'listing'});
 assert.equal(result.jobs[0].companySizeRaw,'20-99人');assert.ok(result.jobs[0].salaryFontStylesheets.includes(css));
 assert.equal(result.jobs[0].experience,'在校/应届');
});
