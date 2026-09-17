import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {jobIdentity,searchUrl,validateSearchUrl,extractPage,buildObservationFacts} from '../../china/platforms.mjs';
import {selectBrowserDriver} from '../../china/driver-choice.mjs';import {createNativeDriver} from '../../china/native-driver.mjs';import {collect} from '../../china/collector.mjs';import {openStore} from '../../china/store.mjs';
import {prepareStudy} from '../../china/market-study.mjs';import {createArchiveProvider} from '../../china/provider-plugin.mjs';import {scanFixture} from './fixtures/provider-scan.mjs';import {readJobSource} from '../../job-source.mjs';
const search='https://www.linkedin.com/jobs/search/?keywords=Agent&location=Shanghai';
const guest=readFileSync(new URL('../fixtures/linkedin-guest-live-onsite.html',import.meta.url),'utf8');
test('LinkedIn identities canonicalize numeric and slug URLs on explicitly supported hosts',()=>{
 for(const url of ['https://www.linkedin.com/jobs/view/123456?trackingId=x','https://cn.linkedin.com/jobs/view/agent-at-company-123456/','https://hk.linkedin.com/jobs/view/123456/'])assert.deepEqual(jobIdentity('linkedin',url),{id:'123456',key:'linkedin:123456',url:'https://www.linkedin.com/jobs/view/123456'});
 for(const url of ['https://evil.test/jobs/view/123456','https://www.linkedin.com/in/123456','https://linkedin.cn/incareer/home','https://www.linkedin.com/jobs/view/no-id'])assert.throws(()=>jobIdentity('linkedin',url));
 assert.equal(new URL(searchUrl('linkedin','Agent & RAG')).searchParams.get('keywords'),'Agent & RAG');assert.equal(validateSearchUrl('linkedin',search),search);
 assert.equal(selectBrowserDriver({platform:'linkedin',system:'darwin'}),'native');
});
async function pageFixture(t){const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());return browser.newPage();}
test('existing public LinkedIn DOM produces complete text, employer and location; navigation sign-in is harmless',async t=>{
 const page=await pageFixture(t);await page.setContent(`<nav>Sign in</nav>${guest}`);const r=await page.evaluate(extractPage,{platform:'linkedin',kind:'detail'});
 assert.equal(r.status,'ok');assert.equal(r.job.title,'Senior Data Analyst');assert.equal(r.job.company,'Acme Corporation');assert.equal(r.job.location,'Remote');assert.match(r.job.description,/executive dashboards/);assert.equal(r.job.openEvidence.quote,'Apply');
});
test('LinkedIn preserves labelled salary/date facts and never treats a repost as original publication',async t=>{
 const page=await pageFixture(t);await page.setContent(guest.replace('</h1>','</h1><span class="salary compensation__salary">USD 100000-140000/year</span><span class="posted-time-ago__text">Reposted 2 days ago</span>'));
 const r=await page.evaluate(extractPage,{platform:'linkedin',kind:'detail'});assert.equal(r.status,'ok');const f=buildObservationFacts(r.job,'2026-09-13T04:00:00Z');
 assert.equal(f.compensation.currency,'USD');assert.equal(f.compensation.period,'year');assert.equal(f.dates[0].kind,'updated');assert.equal(f.dates[0].value,'2026-09-11');
});
test('LinkedIn incomplete, gated and closed views never archive an apparent full JD',async t=>{
 const page=await pageFixture(t);
 for(const [extra,status] of [['<div>Sign in to view the full job description</div>','login_required'],['<div role="dialog">Let’s do a quick security check</div>','challenge'],['<div class="closed-job">No longer accepting applications</div>','closed'],['<button class="show-more-less-html__button--more" aria-expanded="false">Show more</button>','jd_truncated']]){
  await page.setContent(guest.replace('</section>',extra+'</section>'));assert.equal((await page.evaluate(extractPage,{platform:'linkedin',kind:'detail'})).status,status);
 }
});
test('signed-in LinkedIn job insights are not mistaken for salary',async t=>{
 const page=await pageFixture(t);await page.setContent('<div class="job-details-jobs-unified-top-card__container--two-pane"><h1>Agent Engineer</h1><div class="job-details-jobs-unified-top-card__company-name">Example</div><div class="job-details-jobs-unified-top-card__job-insight--highlight">3 skills match your profile</div></div><div id="job-details">Build production AI applications with Python, retrieval augmented generation, evaluation and observability.</div>');
 const r=await page.evaluate(extractPage,{platform:'linkedin',kind:'detail'});assert.equal(r.status,'ok');assert.equal(r.job.company,'Example');assert.equal(r.job.salaryRaw,'');
});
test('LinkedIn visible lists reject off-site links and retain distinct requisitions',async t=>{
 const page=await pageFixture(t);await page.setContent('<li class="base-card"><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/agent-101"><h3 class="base-search-card__title">Agent Engineer</h3></a><h4 class="base-search-card__subtitle">Example</h4><span class="job-search-card__location">Shanghai</span></li><a href="https://evil.test/jobs/view/999">Fake</a><li class="base-card"><a href="https://www.linkedin.com/jobs/view/102">Second Role</a></li>');
 const r=await page.evaluate(extractPage,{platform:'linkedin',kind:'listing'});assert.equal(r.status,'ok');assert.equal(r.jobs.length,2);assert.equal(r.jobs[0].company,'Example');assert.equal(r.jobs[0].location,'Shanghai');
});
test('LinkedIn collection reaches immutable v2 archives and the real original scan with no network or applications',async t=>{
 const root=mkdtempSync(join(tmpdir(),'linkedin-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const page=await pageFixture(t);let launches=0;const requests=[];
 await page.route('**/*',route=>{const u=new URL(route.request().url());requests.push(u.href);return route.fulfill({contentType:'text/html',body:u.pathname.includes('/search')?(u.searchParams.has('start')?'<a href="/jobs/view/103">Senior Data Analyst</a><button aria-label="Next" disabled>Next</button>':'<a href="/jobs/view/101">Senior Data Analyst</a><a href="/jobs/view/102">Senior Data Analyst</a><a rel="next" href="?keywords=Agent&location=Shanghai&start=25">Next</a>'):guest});});
 const driver=await createNativeDriver({root,platform:'linkedin',delayMs:0,timeoutMs:500,pollMs:20,sessionFactory:async o=>{launches++;await page.goto(o.url);return {closed:new Promise(()=>{}),close:async()=>{}};},bridgeFactory:async()=>({tabs:async()=>[{windowId:'owned',tabId:'owned',url:page.url()}],evaluate:async(_,source)=>JSON.parse(await page.evaluate(source)),navigate:async(_,url)=>page.goto(url)})});t.after(()=>driver.close());
 const collected=await collect({root,platform:'linkedin',searchUrl:search,driver,limit:3,maxPages:2});assert.equal(collected.captured,3,JSON.stringify(collected));assert.equal(launches,1);assert.ok(requests.some(u=>u.includes('start=25')));
 const state=openStore(root),selected=Object.values(state.jobs).map(j=>({jobKey:j.key,contentHash:j.latest.hash}));
 const study=await prepareStudy(root,{studyId:'linkedin-fixture',schemaVersion:2,createdAt:new Date(Date.now()+1000).toISOString(),scope:{cities:['Shanghai'],keywords:['Agent'],queryUrls:[search]},selected});
 const offers=await createArchiveProvider('linkedin').fetch({study_id:study.manifest.studyId},{dataRoot:root});assert.equal(offers.length,3);assert.equal(offers[0].sourceRef.providerId,'career-linkedin');
 writeFileSync(join(root,'portals.yml'),JSON.stringify({job_boards:[{name:'LinkedIn fixture',provider:'career-linkedin',study_id:'linkedin-fixture',enabled:true,aggregator:true}]}));const scan=scanFixture(t,root);writeFileSync(join(scan.codeRoot,'config/plugins.yml'),'plugins:\n  career-linkedin:\n    enabled: true\n');
 const result=scan.run();assert.equal(result.status,0,result.stderr+result.stdout);const pipeline=readFileSync(join(root,'data/pipeline.md'),'utf8');const ref=pipeline.match(/archive_ref=([^\s]+)/)?.[1];assert.ok(ref);
 const row=offers.find(o=>pipeline.includes(o.url));const source=await readJobSource(root,{url:row.url,ref});assert.match(source.description,/executive dashboards/);
});
