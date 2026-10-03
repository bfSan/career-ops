import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNativeDriver} from '../../china/native-driver.mjs';
import {collect} from '../../china/collector.mjs';
import {openStore} from '../../china/store.mjs';
import {createRateLimiter} from '../../china/rate-limiter.mjs';

// 规则 1 paces every detail view at 15s by default, which is right against a
// live platform and wrong in a fixture: these cases drive a local Playwright
// browser and would take minutes. Pace is a property of the caller, so each
// collect() here gets an explicit zero-interval limiter. The pacing itself is
// covered by tests/china/rate-limiter.test.mjs; what matters here is that
// collect() consults a limiter at all, which the zero value makes observable —
// a missing limiter would still pass, so the default below is asserted too.
const testLimiter=()=>createRateLimiter({platform:'liepin',intervalMs:0});

const search='https://www.liepin.com/zhaopin/?key=AI&dq=020';
const description='负责人工智能应用系统的设计、开发、测试和部署，要求能够独立完成业务接口集成、性能排查以及生产系统的持续维护。';
async function fixture(t,{nextHref='/zhaopin/?key=AI&dq=020&curPage=1',gate=false,modernButton=false}={}) {
 const root=mkdtempSync(join(tmpdir(),'native-pagination-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),requests=[];let launches=0;
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());requests.push(u.href);
  const second=(u.searchParams.get('curPage')||u.searchParams.get('currentPage'))==='1';
  const cards=(second?[102,103,104]:[101,102]).map(id=>`<li class="job-card-wrapper"><a href="/job/${id}.shtml">AI工程师 ${id}</a><span class="company-name">合成公司</span></li>`).join('');
  const control=modernButton?`<button class="ant-pagination-item-link" onclick="setTimeout(() => location.href='${nextHref}', 30)">下一页</button>`:`<a href="${nextHref}">下一页</a>`;
  const body=u.pathname==='/zhaopin/'?`${cards}<ul class="ant-pagination"><li class="ant-pagination-next${second?' ant-pagination-disabled':''}" aria-disabled="${second}">${control}</li></ul>`:
    gate?'<script>location.replace("https://safe.liepin.com/page/liepin/captchaPage_ip_PC")</script>':`<h1>AI工程师 ${u.pathname.match(/\d+/)?.[0]}</h1><div class="job-description">${description}</div><button onclick="window.applied=true">立即投递</button>`;
  return route.fulfill({contentType:'text/html; charset=utf-8',body:u.hostname==='safe.liepin.com'?'<h1>行为异常</h1><p>请进行安全验证</p>':body});
 });
 const makeDriver=()=>createNativeDriver({root,platform:'liepin',delayMs:0,timeoutMs:600,pollMs:20,
  sessionFactory:async o=>{launches++;await page.goto(o.url);return {closed:new Promise(()=>{}),close:async()=>{}};},
  bridgeFactory:async()=>({tabs:async()=>[{windowId:'owned',tabId:'owned',url:page.url()}],evaluate:async(_,source)=>JSON.parse(await page.evaluate(source)),evaluateVoid:async(tab,source)=>{assert.equal(tab.tabId,'owned');try{await page.evaluate(source);}catch(e){if(!/Execution context was destroyed|Cannot find context/i.test(e.message))throw e;}},navigate:async(_,url)=>page.goto(url)})});
 return {root,page,requests,makeDriver,launches:()=>launches};
}

test('Liepin follows an observed next link after detail navigation and deduplicates page overlap',async t=>{
 const f=await fixture(t),driver=await f.makeDriver();t.after(()=>driver.close());
 const result=await collect({root:f.root,platform:'liepin',searchUrl:search,limit:3,maxPages:2,driver,limiter:testLimiter()});
 assert.equal(result.captured,3,JSON.stringify(result));assert.equal(f.launches(),1);
 assert.deepEqual(Object.keys(openStore(f.root).jobs).sort(),['liepin:job-101','liepin:job-102','liepin:job-103']);
 assert.equal(f.requests.filter(u=>u.endsWith('/job/102.shtml')).length,1);
 assert.equal(await f.page.evaluate(()=>!!window.applied),false);
 assert.ok(f.requests.some(u=>u==='https://www.liepin.com/zhaopin/?key=AI&dq=020&curPage=1'));
});

test('a one-page resume budget can continue pending jobs on the saved second page',async t=>{
 const f=await fixture(t);let driver=await f.makeDriver();
 await collect({root:f.root,platform:'liepin',searchUrl:search,limit:3,maxPages:2,driver,limiter:testLimiter()});await driver.close();
 const state=openStore(f.root);assert.equal(state.runs[0].pageIndex,1);
 driver=await f.makeDriver();t.after(()=>driver.close());
 const result=await collect({root:f.root,platform:'liepin',searchUrl:search,limit:1,maxPages:1,resume:true,driver,limiter:testLimiter()});
 assert.equal(result.reason,'job_limit',JSON.stringify(result));assert.equal(result.captured,4);
 assert.ok(openStore(f.root).jobs['liepin:job-104'].latest.description.includes('生产系统'));
});
// The zero-interval limiter above makes the other cases fast, which also means
// they would still pass if collect() ignored the limiter entirely. Count the
// waits to prove the job loop actually consults it once per detail view.
test('collect() consults the rate limiter once per detail view',async t=>{
  const f=await fixture(t),driver=await f.makeDriver();t.after(()=>driver.close());
  // Count calls, not sleeps: with a zero interval the limiter correctly skips
  // sleeping, so a sleep counter would read 0 and prove nothing.
  let waits=0;
  const base=createRateLimiter({platform:'liepin',intervalMs:0});
  const counting={wait:async(...a)=>{waits++;return base.wait(...a);},pending:()=>base.pending()};
  const result=await collect({root:f.root,platform:'liepin',searchUrl:search,limit:3,maxPages:2,driver,limiter:counting});
  assert.equal(result.captured,3,JSON.stringify(result));
  // 3 details + 1 page turn. Without this the pacing added in 2026-10-02 could
  // be dropped and the suite would stay green.
  assert.equal(waits,4,'expected one wait per detail plus the page turn, got '+waits);
});

test('real Liepin button URL defaults and currentPage can traverse after two details',async t=>{
 const nextHref='/zhaopin/?key=AI&dq=020&pubTime=&currentPage=1&pageSize=40&workYearCode=&salaryCode=&ckId=fixture&skId=fixture&fkId=fixture&scene=page&sfrom=search_job_pc';
 const f=await fixture(t,{nextHref,modernButton:true}),driver=await f.makeDriver();t.after(()=>driver.close());
 const result=await collect({root:f.root,platform:'liepin',searchUrl:search,limit:3,maxPages:2,driver,limiter:testLimiter()});assert.equal(result.captured,3,JSON.stringify(result));assert.ok(openStore(f.root).jobs['liepin:job-103'].latest.description);
});

for(const href of ['https://evil.test/zhaopin/?curPage=1','/zhaopin/?key=AI&dq=070020&curPage=1'])
 test(`Liepin next rejects changed search filters or external destinations: ${href}`,async t=>{
  const f=await fixture(t,{nextHref:href}),driver=await f.makeDriver();t.after(()=>driver.close());
  const result=await collect({root:f.root,platform:'liepin',searchUrl:search,limit:3,maxPages:2,driver,limiter:testLimiter()});
  assert.equal(result.status,'partial');assert.equal(result.reason,'pagination_identity_mismatch');
  assert.ok(!f.requests.some(u=>u.includes('evil.test')||u.includes('070020')));
 });

test('Liepin safe-domain captcha is reported as a challenge, never as an ordinary navigation failure',async t=>{
 const f=await fixture(t,{gate:true}),driver=await f.makeDriver();t.after(()=>driver.close());
 const result=await collect({root:f.root,platform:'liepin',searchUrl:search,limit:2,driver,limiter:testLimiter()});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'challenge');assert.equal(result.captured,0);
 assert.ok(!f.requests.some(u=>u.endsWith('/job/102.shtml')));
});
