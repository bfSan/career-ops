import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {extractPage,buildObservationFacts} from '../../china/platforms.mjs';
import {collect} from '../../china/collector.mjs';import {openStore} from '../../china/store.mjs';
const desc='负责 Agent 系统开发、测试、模型评估和上线，要求具备扎实的软件开发能力，能够独立分析生产故障并推进改进。';
test('bound visible platform fields produce evidenced salary/date facts through real collector',async t=>{
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
 const root=mkdtempSync(join(tmpdir(),'platform-facts-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const platform of ['boss','liepin']){
  const page=await browser.newPage();
  await page.setContent(`<h1>AI工程师</h1><span class="salary-label">人民币月薪</span><span class="salary">30–50K·13薪</span><span class="job-publish-time">今天发布</span><span class="job-refresh-time">更新于2026-09-11</span><span class="job-time" hidden>2026-01-01发布</span><div class="${platform==='boss'?'job-sec-text':'job-description'}">${desc}</div>`);
  const detail=await page.evaluate(extractPage,{platform,kind:'detail'});assert.equal(detail.status,'ok');
  const facts=buildObservationFacts(detail.job,'2026-09-11T16:30:00.000Z');
  assert.equal(facts.compensation.min,30000);assert.equal(facts.dates[0].value,'2026-09-12');assert.equal(facts.dates.length,2);
  const url=platform==='boss'?'https://www.zhipin.com/job_detail/facts1.html':'https://www.liepin.com/job/12345.shtml';
  const driver={listing:async()=>({status:'ok',jobs:[{url,title:'AI工程师',salaryRaw:'99K'}]}),detail:async()=>detail,next:async()=>({status:'end'})};
  const result=await collect({root,platform,searchUrl:platform==='boss'?'https://www.zhipin.com/web/geek/jobs?query=AI':'https://www.liepin.com/zhaopin/?key=AI',limit:1,driver});
  assert.equal(result.captured,1);const job=Object.values(openStore(root).jobs).find(j=>j.platform===platform);
  assert.equal(job.lastAttempt.facts.compensation.min,30000);assert.equal(job.lastAttempt.facts.dates[0].observedAt,job.lastAttempt.at);
  await page.close();
 }
});
test('unlabeled dates and unqualified pay never get guessed',async t=>{
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent(`<h1>AI</h1><span class="salary">30–50K</span><span class="job-time">3天前</span><div class="job-sec-text">${desc} 发布时间：2026-01-01</div>`);
 const result=await page.evaluate(extractPage,{platform:'boss',kind:'detail'});
 const facts=buildObservationFacts(result.job,'2026-09-12T00:00:00Z');assert.equal(facts.compensation.status,'unknown');
 assert.equal(facts.dates[0].kind,'unknown');assert.equal(facts.dates[0].value,null);
});
test('current Liepin data-selector JD and header stay separate from recommended job cards',async t=>{
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent(`<main><content><section class="job-apply-container"><div class="job-apply-content"><div class="name-box"><span class="job-title">实际AI岗位</span><span class="salary">10-30k</span></div><div class="job-properties"><span>北京-朝阳区</span><span class="split"></span><span>3-5年</span><span>本科</span><span class="update-time">9月8日更新</span></div></div><div class="job-apply-operate"><a data-selector="apply-job" href="javascript:void(0)" onclick="window.applied=true">投简历</a></div></section><section class="job-intro-container"><dl><dt>职位介绍</dt><dd data-selector="job-intro-content">${desc}</dd></dl></section><section class="love-job-container"><div class="job-detail-box"><span class="job-title">错误推荐岗位</span><span class="salary">90-99k</span><span class="company-name">错误公司</span></div></section></content><aside><div class="company-info-container"><div class="company-card"><div class="content"><div class="name">实际公司</div></div></div></div></aside></main><script>window.applied=false</script>`);
 const result=await page.evaluate(extractPage,{platform:'liepin',kind:'detail'});
 assert.equal(result.status,'ok');assert.equal(result.job.description,desc);assert.equal(result.job.title,'实际AI岗位');assert.equal(result.job.salaryRaw,'10-30k');assert.equal(result.job.company,'实际公司');assert.equal(result.job.location,'北京-朝阳区');assert.equal(result.job.experience,'3-5年');assert.equal(result.job.openEvidence.quote,'投简历');assert.equal(await page.evaluate(()=>window.applied),false);
 const facts=buildObservationFacts(result.job,'2026-09-12T00:00:00Z');assert.equal(facts.dates[0].kind,'updated');assert.equal(facts.dates[0].value,null);assert.equal(facts.compensation.status,'unknown');
 const {classifyDomesticResult}=await import('../../china/liveness.mjs');const url='https://www.liepin.com/job/12345.shtml';
 assert.equal(classifyDomesticResult(url,'liepin',{...result,job:{...result.job,url}}).result,'active');
});

test('a body arriving before its detail header is not a complete observation',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent(`<section class="job-apply-container"></section><section class="job-intro-container"><dd data-selector="job-intro-content">${desc}</dd></section>`);
 assert.equal((await page.evaluate(extractPage,{platform:'liepin',kind:'detail'})).status,'extraction_failed');
 await page.locator('.job-apply-container').evaluate(el=>el.innerHTML='<span class="job-title">AI工程师</span><span class="salary">20-30k</span>');
 const ready=await page.evaluate(extractPage,{platform:'liepin',kind:'detail'});assert.equal(ready.status,'ok');assert.equal(ready.job.salaryRaw,'20-30k');
});
