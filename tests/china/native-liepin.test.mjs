import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createNativeDriver} from '../../china/native-driver.mjs';import {collect} from '../../china/collector.mjs';import {openStore} from '../../china/store.mjs';
const search='https://www.liepin.com/zhaopin/?key=AI',jd='负责生产级 AI Agent 开发、测试和部署，具备完整的模型评估和服务监控经验，能够独立完成复杂需求。';
async function setup(t,mode='normal'){
 const root=mkdtempSync(join(tmpdir(),'liepin-native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),requests=[];
 await page.route('**/*',r=>{const p=new URL(r.request().url()).pathname;requests.push(p);return r.fulfill({contentType:'text/html; charset=utf-8',body:p==='/zhaopin/'?'<li class="job-card-wrapper"><a href="/job/101.shtml">AI工程师</a><span class="company-name">测试</span></li><li class="job-card-wrapper"><a href="/job/102.shtml">AI工程师</a></li>':mode==='login'?'<p>扫码登录</p>':mode==='challenge'?'<p>请完成安全验证</p>':`${mode==='wrong-id'?'<script>history.replaceState(null,"","/job/999.shtml")</script>':''}${mode==='short'&&p==='/job/101.shtml'?'<div class="job-apply-container"><h1>AI工程师</h1></div><div class="job-intro-container"><div data-selector="job-intro-content">通过应用AI帮助企业各个环节提效</div></div>':`<h1>AI工程师</h1><div class="job-description">${jd}${p}</div>`}<button onclick="window.contacted=true">立即投递</button><script>window.contacted=false</script>`});});
 let launches=0,closes=0,tabReads=0,inventory;const driver=await createNativeDriver({root,platform:'liepin',delayMs:0,timeoutMs:500,pollMs:20,
  sessionFactory:async o=>{launches++;await page.goto(o.url);return {closed:new Promise(()=>{}),close:async()=>{closes++;}};},
  bridgeFactory:async()=>({tabs:async()=>{tabReads++;if(inventory)return inventory();return mode==='startup'&&tabReads<=2?[]:[{windowId:'owned',tabId:'owned',url:mode==='startup'&&tabReads===3?'about:blank':page.url()}];},evaluate:async(tab,source)=>{assert.equal(tab.tabId,'owned');return JSON.parse(await page.evaluate(source));},evaluateVoid:async(tab,source)=>{assert.equal(tab.tabId,'owned');page.evaluate(source).catch(e=>{if(!/Execution context was destroyed|Cannot find context|Target closed/i.test(e.message))throw e;});},navigate:async(tab,url)=>{assert.equal(tab.tabId,'owned');if(mode==='old-document')await page.evaluate(url=>history.replaceState(null,'',url),url);else await page.goto(url);}})});t.after(()=>driver.close());
 return {root,page,driver,requests,setInventory:fn=>{inventory=fn;},counts:()=>({launches,closes})};
}
test('native Liepin keeps one cookie session and archives two identity-bound JDs without clicking apply',async t=>{
 const s=await setup(t);const result=await collect({root:s.root,platform:'liepin',searchUrl:search,limit:2,driver:s.driver});
 assert.equal(result.captured,2);assert.equal(s.counts().launches,1);assert.equal(await s.page.evaluate(()=>window.contacted),false);
 // Between two job pages the driver returns to the listing so the next card is
 // clickable again — the click-through leaves the tab on the job page, and
 // 猎聘 only serves a job page reached from a listing. That hop is part of the
 // contract now, so it is asserted rather than tolerated.
 assert.deepEqual(s.requests,['/zhaopin/','/job/101.shtml','/zhaopin/','/job/102.shtml']);
 assert.ok(openStore(s.root).jobs['liepin:job-102'].latest.description.endsWith('/job/102.shtml'));
});
for(const [mode,status] of [['login','login_required'],['challenge','challenge'],['wrong-id','identity_mismatch']])test(`native Liepin ${mode} stops before remaining jobs`,async t=>{
 const s=await setup(t,mode),list=await s.driver.listing(search);
 assert.equal((await s.driver.detail(list.jobs[0])).status,status);assert.equal((await s.driver.detail(list.jobs[1])).status,status);
 assert.deepEqual(s.requests,['/zhaopin/','/job/101.shtml']);assert.equal(s.counts().closes,1);
});
test('native Liepin refuses an unobserved job URL without navigating',async t=>{
 const s=await setup(t);await s.driver.listing(search);
 assert.equal((await s.driver.detail({url:'https://www.liepin.com/job/999.shtml'})).status,'identity_mismatch');assert.deepEqual(s.requests,['/zhaopin/']);
});

test('a new URL in an old document cannot become a captured Liepin JD',async t=>{
 const s=await setup(t,'old-document'),list=await s.driver.listing(search);
 await s.page.evaluate(body=>{document.body.innerHTML=`<h1>AI工程师</h1><div class="job-description">${body}</div>`;},jd);
 assert.equal((await s.driver.detail(list.jobs[0])).status,'extraction_failed');
 assert.deepEqual(s.requests,['/zhaopin/']);
});
test('unexpected same-platform user navigation stops before overwriting the owned tab',async t=>{
 const s=await setup(t),list=await s.driver.listing(search);await s.page.goto('https://www.liepin.com/job/999.shtml');
 assert.equal((await s.driver.detail(list.jobs[0])).status,'navigation_changed');
 assert.deepEqual(s.requests,['/zhaopin/','/job/999.shtml']);
});

test('native Liepin waits for initial Chrome tabs and blank startup without reopening a session',async t=>{
 const s=await setup(t,'startup'),list=await s.driver.listing(search);
 assert.equal(list.status,'ok');assert.equal(list.jobs.length,2);assert.equal(s.counts().launches,1);assert.equal(s.counts().closes,0);assert.deepEqual(s.requests,['/zhaopin/']);
});

for(const mode of ['transient','missing','replaced','extra','challenge'])test(`native Liepin bound inventory ${mode} preserves ownership and page gates`,async t=>{
 const s=await setup(t),list=await s.driver.listing(search);let reads=0;
 s.setInventory(async()=>{reads++;if(reads===1||mode==='missing')return [];if(mode==='challenge')await s.page.evaluate(()=>history.replaceState(null,'','/captcha/'));const tab={windowId:'owned',tabId:mode==='replaced'?'replacement':'owned',url:s.page.url()};return mode==='extra'?[tab,{...tab,tabId:'extra'}]:[tab];});
 const result=await s.driver.detail(list.jobs[0]);
 assert.equal(result.status,{transient:'ok',missing:'browser_closed',replaced:'browser_closed',extra:'unexpected_browser_tab',challenge:'challenge'}[mode]);
 if(mode==='transient'){assert.ok(result.job.description.endsWith('/job/101.shtml'));assert.equal(s.counts().closes,0);}else{assert.deepEqual(s.requests,['/zhaopin/']);assert.equal(s.counts().closes,1);}
});

test('native short JD continues in the same session to the next complete JD',async t=>{
 const s=await setup(t,'short');const r=await collect({root:s.root,platform:'liepin',searchUrl:search,limit:5,driver:s.driver});
 assert.equal(r.captured,1);assert.equal(r.sourceGaps.length,1);assert.equal(r.status,'limited');assert.equal(s.counts().launches,1);assert.equal(s.counts().closes,0);
 assert.equal(openStore(s.root).jobs['liepin:job-101'].latest,undefined);assert.ok(openStore(s.root).jobs['liepin:job-102'].latest);
});
