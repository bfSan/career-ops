import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFileSync} from 'node:fs';
import {createNativeDriver} from '../../china/native-driver.mjs';import {createBrowserDriver} from '../../china/browser.mjs';import {parsePostingDate} from '../../posting-dates.mjs';
const guest=readFileSync(new URL('../fixtures/linkedin-guest-live-onsite.html',import.meta.url),'utf8');
async function fixture(t,platform,body){const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());const context=await browser.newContext(),requests=[];await context.route('**/*',r=>{requests.push(r.request().url());return r.fulfill({contentType:'text/html',body:body(new URL(r.request().url()))});});return {context,requests};}
for(const route of ['native','playwright'])test(`${route} LinkedIn expands only the description control once, then reads visible complete text`,async t=>{
 const search='https://www.linkedin.com/jobs/search/?keywords=Agent';const full='Build reliable AI applications, design and measure evaluations, own production APIs, monitoring, testing and continuous delivery.';
 const f=await fixture(t,'linkedin',u=>u.pathname.includes('/search')?'<a href="/jobs/view/101">Senior Data Analyst</a>':guest.replace('<div class="description__text">',`<div class="description__text"><button class="show-more-less-html__button--more" aria-expanded="false" onclick="this.nextElementSibling.textContent='${full}';this.style.display='none';window.expansions=(window.expansions||0)+1">Show more</button>`));
 const page=await f.context.newPage();const driver=route==='native'?await createNativeDriver({platform:'linkedin',delayMs:0,timeoutMs:800,pollMs:20,sessionFactory:async o=>{await page.goto(o.url);return {closed:new Promise(()=>{}),close:async()=>{}};},bridgeFactory:async()=>({tabs:async()=>[{windowId:'owned',tabId:'owned',url:page.url()}],evaluate:async(_,s)=>JSON.parse(await page.evaluate(s)),navigate:async(_,u)=>page.goto(u)})}):await createBrowserDriver({platform:'linkedin',context:f.context,delayMs:0,timeoutMs:800});t.after(()=>driver.close());
 const list=await driver.listing(search),result=await driver.detail(list.jobs[0]);assert.equal(result.status,'ok');assert.equal(result.job.description,full);
 const detail=f.context.pages().find(p=>p.url().includes('/jobs/view/'));assert.equal(await detail.evaluate(()=>window.expansions),1);
});
test('Playwright Liepin rejects an external next href before requesting it',async t=>{
 const f=await fixture(t,'liepin',()=>'<a href="https://www.liepin.com/job/101.shtml">AI工程师</a><a class="ant-pagination-next" href="https://evil.test/zhaopin/?curPage=1">下一页</a>');const driver=await createBrowserDriver({platform:'liepin',context:f.context,delayMs:0,timeoutMs:500});t.after(()=>driver.close());await driver.listing('https://www.liepin.com/zhaopin/?key=AI');assert.equal((await driver.next()).status,'pagination_identity_mismatch');assert.equal(f.requests.some(u=>u.includes('evil.test')),false);
});
test('Playwright recognizes safe.liepin.com security redirects',async t=>{
 const f=await fixture(t,'liepin',u=>u.hostname==='safe.liepin.com'?'<h1>行为异常</h1>':'<script>location.replace("https://safe.liepin.com/page/liepin/captchaPage_ip_PC")</script>');const driver=await createBrowserDriver({platform:'liepin',context:f.context,delayMs:0,timeoutMs:500});t.after(()=>driver.close());assert.equal((await driver.listing('https://www.liepin.com/zhaopin/?key=AI')).status,'challenge');
});
test('imprecise LinkedIn weeks and months remain raw evidence without a fabricated exact date',()=>{
 for(const raw of ['2 weeks ago','6 months ago'])assert.equal(parsePostingDate({kind:'published',raw,observedAt:'2026-09-13T12:00:00Z',timezone:'Asia/Shanghai',evidence:{field:'visibleText',quote:raw}}).value,null);
});
