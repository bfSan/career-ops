import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {chromium} from 'playwright';import * as yaml from 'js-yaml';
import {createNativeDriver} from '../../china/native-driver.mjs';import {collect} from '../../china/collector.mjs';import {openStore} from '../../china/store.mjs';
import {prepareStudy} from '../../china/market-study.mjs';import {summarize} from '../../china/market-summary.mjs';import {connectMarket} from '../../china/market-connections.mjs';
import {createArchiveProvider} from '../../china/provider-plugin.mjs';import {readJobSource} from '../../job-source.mjs';import {reportToObservation} from '../../salary-gap.mjs';
import {description,options,analysis} from './fixtures/market-data.mjs';import {scanFixture} from './fixtures/provider-scan.mjs';

test('visible DOM through native collector, v2, original scan and salary-gap shares exactly one set of facts',async t=>{
 const root=mkdtempSync(join(tmpdir(),'provider-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),search='https://www.zhipin.com/web/geek/jobs?query=AI',url='https://www.zhipin.com/job_detail/workflow.html';
 const html=`<div class="job-list-container"><div class="job-card-wrap active"><li class="job-card-box"><a class="job-name" href="/job_detail/workflow.html">AI工程师</a><span class="company-name">合成公司</span><span class="job-area">上海</span></li></div></div><div class="job-detail-container"><div class="job-detail-header"><span class="job-name">AI工程师</span><span class="salary-label">人民币月薪</span><span class="salary">30–50K·13薪</span><span class="job-publish-time">2026-09-12发布</span></div><div class="job-detail-body"><p class="desc">${description}</p><a class="more-job-btn" href="/job_detail/workflow.html">更多</a><button onclick="window.contacted=true">立即沟通</button></div></div><script>window.contacted=false</script>`;
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
 const driver=await createNativeDriver({root,delayMs:0,timeoutMs:500,pollMs:25,
  sessionFactory:async o=>{await page.goto(o.url);return {closed:new Promise(()=>{}),close:async()=>{}};},
  bridgeFactory:async()=>({tabs:async()=>[{windowId:'owned',tabId:'owned',url:page.url()}],evaluate:async(_,source)=>JSON.parse(await page.evaluate(source))})});t.after(()=>driver.close());
 const collected=await collect({root,platform:'boss',searchUrl:search,driver,limit:1});assert.equal(collected.captured,1,JSON.stringify(collected));assert.equal(await page.evaluate(()=>window.contacted),false);
 const state=openStore(root),job=state.jobs['boss:workflow'],facts=job.lastAttempt.facts;
 assert.equal(facts.dates[0].value,'2026-09-12');assert.equal(facts.compensation.annualizedMonthly.min,360000);
 const study=await prepareStudy(root,{...options([{jobKey:job.key,contentHash:job.latest.hash}]),schemaVersion:2,createdAt:new Date(Date.now()+1000).toISOString()});
 const bundle={...analysis(study),schemaVersion:2},summary=summarize(study,bundle),connections=connectMarket(study,summary,state);
 const [offer]=await createArchiveProvider('boss').fetch({study_id:study.manifest.studyId},{dataRoot:root});
 assert.equal(offer.salary.min,360000);assert.equal(summary.compensationGroups[0].medianRangeMidpoint,480000);
 writeFileSync(join(root,'portals.yml'),JSON.stringify({salary_filter:{min:300000,currency:'CNY'},job_boards:[{name:'fixture',provider:'career-boss',study_id:study.manifest.studyId,enabled:true,aggregator:true}]}));
 const scan=scanFixture(t,root).run(['--posted-after','2026-09-12','--posted-before','2026-09-12']);assert.equal(scan.status,0,scan.stderr+scan.stdout);
 const pipeline=readFileSync(join(root,'data/pipeline.md'),'utf8');assert.match(pipeline,/360000.*600000 CNY/);assert.match(readFileSync(join(root,'data/scan-history.tsv'),'utf8'),/2026-09-12/);
 const ref=pipeline.match(/archive_ref=([^\s]+)/)?.[1];assert.ok(ref);
 const archived=await readJobSource(root,{url,ref});assert.equal(archived.description,description);
 const normalized={raw:facts.compensation.raw,currency:offer.salary.currency,period:'year',min:offer.salary.min,max:offer.salary.max,basis:'monthly_x12',evidence:facts.compensation.evidence};
 const report=`## Machine Summary\n\n\`\`\`yaml\n${yaml.dump({company:offer.company,role:offer.title,advertised_comp:normalized.raw,advertised_comp_normalized:normalized})}\`\`\`\n`;
 const observation=reportToObservation(report,'001','2026-09-12').observation;assert.equal(observation.parsed.min,360000);assert.equal(observation.currency,offer.salary.currency);
 assert.equal(existsSync(join(root,'data/applications.md')),false);
 assert.equal(connections.modules.find(m=>m.id==='check-liveness').status,'implemented');
 assert.equal(connections.modules.find(m=>m.id==='detect-reposts').status,'connected');
 assert.equal(connections.modules.find(m=>m.id==='posting-dates').status,'connected');
});
