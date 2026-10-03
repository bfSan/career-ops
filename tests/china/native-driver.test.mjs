import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createNativeDriver} from '../../china/native-driver.mjs';
import {collect} from '../../china/collector.mjs';
import {createRateLimiter} from '../../china/rate-limiter.mjs';

// collect() builds a real 15s limiter when the caller passes none, which is
// right in production and wrong here: the suite would spend minutes sleeping.
// A zero interval still consults the pacing logic once per action.
const testLimiter=()=>createRateLimiter({platform:'boss',intervalMs:0});
import {openStore} from '../../china/store.mjs';

const url='https://www.zhipin.com/web/geek/jobs?city=101020100&query=agent';
const jd=id=>`${id}：负责生产级 Agent 系统设计和实现，包括工具调用、权限隔离、模型评测和日志分析。要求具备扎实的工程经验，能够独立分析故障并推动修复。`;
const panel=id=>`<div class="job-detail-header"><span class="job-name">Agent ${id}</span></div><div class="job-detail-body"><p class="desc">${jd(id)}</p><a class="more-job-btn" href="/job_detail/${id}.html">更多</a><button onclick="window.contacted=true">立即沟通</button></div>`;
// The driver opens the platform homepage and types the query, because BOSS
// downgrades a listing request that did not come from a person. The stub
// therefore has to offer a real search box whose submit moves the page to the
// results, or the whole path would go untested.
function homeFixture(mode){
 // In security-check mode the results address comes back carrying BOSS's own
 // marker, which is what the site does after its environment check and what
 // the driver must not mistake for the user navigating away.
 const suffix=mode==='security-check'?'&_security_check=6_1790989427107':'';
 return `<form class="search-form" onsubmit="event.preventDefault();location.href='/web/geek/jobs?city=101020100&query='+encodeURIComponent(document.querySelector('.search-input').value)+'${suffix}'">
  <input class="search-input" type="text" placeholder="搜索职位、公司">
  <button class="btn-search" type="submit">搜索</button>
 </form><div class="home-hint">首页</div>`;
}

function fixture(mode){
 // closed-first has to live in the served HTML, because the session now opens
 // on the homepage: there is no moment where the test can mutate a live page.
 const closed=mode==='closed-first';
 const firstPanel=closed?`<div class="job-detail-header"><span class="job-name">Agent a1</span></div><div class="job-detail-body"><p class="desc">\n该职位已关闭\n</p></div>`:panel('a1');
 return `<div class="job-list-container">${['a1','a2','a3'].map(id=>`<div class="job-card-wrap ${id==='a1'?'active':''}"><li class="job-card-box ${closed&&id==='a1'?'is-close':''}"><a class="job-name" href="/job_detail/${id}.html">Agent ${id}</a><span class="salary">30-50K</span><span class="company-name">合成公司</span></li></div>`).join('')}</div><div class="job-detail-container">${firstPanel}</div><button class="next" disabled>下一页</button><script>
window.contacted=false;window.selected=[];
document.querySelectorAll('.job-card-box').forEach(card=>card.onclick=()=>{
 const id=card.querySelector('a').getAttribute('href').split('/').pop().split('.')[0];window.selected.push(id);
 document.querySelectorAll('.job-card-wrap').forEach(w=>w.classList.toggle('active',w===card.parentElement));
 const box=document.querySelector('.job-detail-container');box.insertAdjacentHTML('afterbegin','<div class="job-detail-loading">加载中</div>');
 setTimeout(()=>{box.innerHTML=${JSON.stringify(panel('TOKEN'))}.replaceAll('TOKEN',${JSON.stringify(mode)}==='stale'?'a1':id);if(${JSON.stringify(mode)}==='challenge')box.innerHTML='<p>请完成安全验证</p>';},50);
});</script>`;}

async function setup(t,mode='normal',delayMs=0){
 const root=mkdtempSync(join(tmpdir(),'china-native-driver-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
 const context=await browser.newContext(),page=await context.newPage(),requests=[];
 await context.route('**/*',r=>{const p=new URL(r.request().url()).pathname;requests.push(p);
  const listing=/^\/web\/geek\/jobs/.test(p)?fixture(mode):null;
  return r.fulfill({contentType:'text/html; charset=utf-8',body:listing??homeFixture(mode)});});
 let closes=0,launches=0,exitSession,beforeEvaluate,afterEvaluate,inventory;const recorded=[],inFlight=new Set();
 const exited=new Promise(resolve=>{exitSession=resolve;});
 // only wrong-search lands directly on a results address: it is testing what
 // the driver does when the page already shows something else. Every other
 // mode starts on the homepage and lets the driver search, as a real run does.
 const sessionFactory=async options=>{launches++;
  // redirected-home models the platform answering a profile address with a
  // different one. Stated as the landing address rather than a redirect: a real
  // 302 would send the page through BOSS's own security flow, which this stub
  // does not and should not model.
  const landing=mode==='wrong-search'?'https://www.zhipin.com/web/geek/jobs?query=other'
   :mode==='redirected-home'?'https://www.zhipin.com/':null;
  await page.goto(landing||options.url);
  return {pid:123,closed:exited,close:async()=>{closes++;await page.close();exitSession();}};};
 const bridgeFactory=async()=>({
  tabs:async()=>inventory?inventory():page.isClosed()?[]:[{windowId:'owned-window',tabId:'owned-tab',url:page.url()}],
  evaluate:async(tab,source)=>{assert.equal(tab.tabId,'owned-tab');await beforeEvaluate?.(source);const result=JSON.parse(await page.evaluate(source));await afterEvaluate?.(source);return result;},
  // The click and the search submit both navigate, so this evaluation's context
  // is destroyed before it can return a value — that is the expected outcome,
  // not something the driver has to see.
  //
  // The production bridge dispatches and forgets. The double has to await
  // instead: an evaluation left in flight outlives the test that sent it, and
  // when it finally lands it runs against whichever page the next test has
  // open. That is what made this file flaky — a click from one test arriving in
  // another. Waiting keeps the effect inside the test that asked for it; the
  // settled value is discarded either way, which is the whole point of the
  // void call.
  evaluateVoid:async(tab,source)=>{assert.equal(tab.tabId,'owned-tab');
   await beforeEvaluate?.(source);
   // Dispatched and forgotten, like the real bridge. Waiting is not an option:
   // Playwright's page.evaluate hangs on the navigation the click causes, which
   // is precisely what the production call avoids by not awaiting.
   //
   // The pending work is tracked so it can be settled before the test ends. An
   // evaluation left in flight outlives its test, and when it lands it runs
   // against whichever page the next test has open.
   const running=page.evaluate(source).catch(e=>{
    if(!/Execution context was destroyed|Cannot find context|Target closed/i.test(e.message))recorded.push(String(e.message));});
   inFlight.add(running);
   running.finally(()=>inFlight.delete(running));},navigate:async(tab,target)=>{assert.equal(tab.tabId,'owned-tab');await page.goto(target);},
 });
 const driver=await createNativeDriver({root,platform:'boss',sessionFactory,bridgeFactory,delayMs,timeoutMs:500,pollMs:25});
 t.after(async()=>{
  // Settle anything evaluateVoid left in flight, then close. The order matters:
  // waiting after the page is gone would wait on evaluations that can never
  // settle, and letting them run past the test lands them on the next test's
  // page — a click from one test arriving in another.
  //
  // Bounded, because an evaluation whose page died mid-flight never settles at
  // all, and an unbounded wait in teardown would hang the whole run.
  if(inFlight.size)await Promise.race([
   Promise.allSettled([...inFlight]),
   new Promise(resolve=>setTimeout(resolve,2000))]);
  await driver.close();});
 return {root,driver,page,requests,recorded,exitSession,setInventory:fn=>{inventory=fn;},beforeEvaluate:fn=>{beforeEvaluate=fn;},afterEvaluate:fn=>{afterEvaluate=fn;},counts:()=>({closes,launches})};
}

test('native driver archives three consecutive matching JDs in one cookie session',async t=>{
 const s=await setup(t);
 const result=await collect({root:s.root,platform:'boss',searchUrl:url,driver:s.driver,limit:3,limiter:testLimiter()});
 assert.equal(result.status,'limited');assert.equal(result.captured,3);
 const state=openStore(s.root);
 for(const id of ['a1','a2','a3']){const job=state.jobs[`boss:${id}`];assert.equal(job.latest.description,jd(id));assert.ok(readFileSync(join(s.root,job.latest.capturePath),'utf8').includes(jd(id)));}
 // The driver opens the homepage and types the query rather than navigating to
 // the results address, so the first request is the homepage. See
 // china/search-box.mjs for what the site measures.
 assert.deepEqual(s.requests,['/web/user/','/web/geek/jobs']);
 assert.deepEqual(await s.page.evaluate(()=>({selected,contacted})),{selected:['a2','a3'],contacted:false});
 assert.equal(s.counts().launches,1);
 assert.equal((await s.driver.next()).status,'end');
});

test('native detail exposes bound read-only openness evidence for the liveness consumer',async t=>{
 const s=await setup(t),listing=await s.driver.listing(url),result=await s.driver.detail(listing.jobs[0]);
 assert.equal(result.job.url,'https://www.zhipin.com/job_detail/a1.html');
 assert.equal(result.job.openEvidence.quote,'立即沟通');assert.equal(await s.page.evaluate(()=>window.contacted),false);
});

for(const [mode,status] of [['stale','extraction_failed'],['challenge','challenge']])test(`native driver rejects ${mode} without saving another card's JD`,async t=>{
 const s=await setup(t,mode),listing=await s.driver.listing(url);
 assert.equal((await s.driver.detail(listing.jobs[1])).status,status);
 if(mode==='challenge')assert.equal(s.counts().closes,1);
});

test('native driver notices a late challenge during the operation delay and stops before clicking',async t=>{
 const s=await setup(t,'normal',150),listing=await s.driver.listing(url);
 await s.page.evaluate(()=>setTimeout(()=>history.replaceState({},'','/web/passport/zp/security.html?code=37'),30));
 assert.equal((await s.driver.detail(listing.jobs[1])).status,'challenge');
 assert.equal(s.counts().closes,1);
 // The driver opens the homepage and types the query rather than navigating to
 // the results address, so the first request is the homepage. See
 // china/search-box.mjs for what the site measures.
 assert.deepEqual(s.requests,['/web/user/','/web/geek/jobs']);
});

test('native driver rejects changed search and missing cards',async t=>{
 const s=await setup(t),listing=await s.driver.listing(url);
 assert.equal((await s.driver.detail({url:'https://www.zhipin.com/job_detail/missing.html',title:'missing'})).status,'extraction_failed');
 await s.page.evaluate(()=>history.replaceState({},'','/web/geek/jobs?query=other'));
 assert.equal((await s.driver.detail(listing.jobs[1])).status,'navigation_changed');
});

test('native driver refuses reuse for another search instead of reading the old document',async t=>{
 const s=await setup(t);await s.driver.listing(url);
 assert.equal((await s.driver.listing('https://www.zhipin.com/web/geek/jobs?query=other')).status,'driver_already_started');
 // The driver opens the homepage and types the query rather than navigating to
 // the results address, so the first request is the homepage. See
 // china/search-box.mjs for what the site measures.
 assert.deepEqual(s.requests,['/web/user/','/web/geek/jobs']);
});

test('native driver stops when its owned process exits even if a tab with reused IDs is returned',async t=>{
 const s=await setup(t),listing=await s.driver.listing(url);
 s.exitSession();await Promise.resolve();
 assert.equal((await s.driver.detail(listing.jobs[1])).status,'browser_closed');
 assert.deepEqual(await s.page.evaluate(()=>selected),[]);
});

test('same-URL challenge arriving at the final click boundary prevents selection',async t=>{
 const s=await setup(t),listing=await s.driver.listing(url);
 // The point of the test is that the card never gets selected, so the state to
 // capture is the one *before* the click — nothing needs observing afterwards.
 // Reading it after the injection meant waiting on an evaluation that
 // evaluateVoid never completes by design, and the timing of that wait was
 // what made this file flaky.
 let selectedBeforeClick;
 s.beforeEvaluate(async source=>{
  if(source.includes('"click":true')){
   selectedBeforeClick=await s.page.evaluate(()=>selected.length);
   await s.page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="dialog">请完成安全验证</div>'));
  }
 });
 assert.equal((await s.driver.detail(listing.jobs[1])).status,'challenge');
 assert.equal(selectedBeforeClick,0);
 assert.equal(s.counts().closes,1);
});

test('a closed first panel cannot label the remaining active cards as closed',async t=>{
 const s=await setup(t,'closed-first',50);
 const result=await collect({root:s.root,platform:'boss',searchUrl:url,driver:s.driver,limit:3,limiter:testLimiter()});
 assert.equal(result.closed,1);assert.equal(result.captured,2);
 const state=openStore(s.root);
 assert.equal(state.jobs['boss:a1'].lastAttempt.status,'closed');
 for(const id of ['a2','a3'])assert.equal(state.jobs[`boss:${id}`].latest.description,jd(id));
});

test('a session the platform answers with a different home address still searches',async t=>{
 // BOSS does not keep the profile address it is sent: /web/user/ comes back
 // as /. Matching the exact login address called every run navigation_changed
 // while a usable search box sat on the page, so the home check compares origin
 // and shape instead of one string.
 const s=await setup(t,'redirected-home');
 const list=await s.driver.listing(url);
 assert.equal(list.status,'ok');
 assert.ok(list.jobs.length>0);
 // The landing address is the one the platform answered with, not the one asked for.
 assert.deepEqual(s.requests,['/','/web/geek/jobs']);
});

test('native driver rejects an initial search with different query conditions',async t=>{
 const s=await setup(t,'wrong-search');
 assert.equal((await s.driver.listing(url)).status,'navigation_changed');
});

test('the security marker BOSS appends is not mistaken for the user navigating away',async t=>{
 // BOSS rewrites the address with _security_check after its own environment
 // check. Treating that as user navigation called every resumed session
 // navigation_changed while the page sat there holding 127 job links — the
 // run reported zero and the data was there. Measured 2026-10-02.
 const s=await setup(t,'security-check');
 const list=await s.driver.listing(url);
 assert.equal(list.status,'ok');
 assert.ok(list.jobs.length>0);
});

test('a void evaluation that fails for an unexpected reason is recorded, not swallowed',async t=>{
 // evaluateVoid is fire-and-forget, so a real failure has no other way to
 // become visible. The tolerated cases are the context destructions a
 // navigating click causes; anything else is a defect and must be kept.
 const s=await setup(t);
 await s.page.evaluate(()=>{window.__boom=1;});
 s.page.once('console',()=>{});
 const listing=await s.driver.listing(url);
 assert.equal(listing.status,'ok');
 await s.page.evaluate(()=>{delete window.__boom;});
 assert.deepEqual(s.recorded,[],'a clean run records nothing');
});

test('a busy dedicated profile reports its actual blocker without launching a second browser',async t=>{
 const root=mkdtempSync(join(tmpdir(),'native-profile-busy-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'data/china/browser/boss'),{recursive:true});symlinkSync(`${hostname()}-${process.pid}`,join(root,'data/china/browser/boss/SingletonLock'));
 const driver=await createNativeDriver({root,delayMs:0});t.after(()=>driver.close());
 assert.equal((await driver.listing(url)).status,'browser_profile_in_use');
});

for(const mode of ['append','unchanged','challenge'])test(`BOSS document-scrolling list handles ${mode} without scrolling the JD panel`,async t=>{
 const s=await setup(t);await s.driver.listing(url);
 await s.page.evaluate(mode=>{
  document.querySelector('button.next').remove();
  const list=document.querySelector('.job-list-container');list.style.minHeight='2200px';
  const panel=document.querySelector('.job-detail-container');
  Object.assign(panel.style,{position:'fixed',top:'0px',right:'0px',height:'80px',width:'200px',overflowY:'auto'});
  window.addEventListener('scroll',()=>{
   if(mode==='append'){
    const card=document.querySelector('.job-card-wrap').cloneNode(true);
    card.classList.remove('active');const a=card.querySelector('.job-name');a.href='/job_detail/a4.html';a.textContent='Agent a4';list.append(card);
   }else if(mode==='challenge')document.body.insertAdjacentHTML('beforeend','<div role="dialog">请完成安全验证</div>');
  },{once:true});
 },mode);
 const result=await s.driver.next();
 if(mode==='append'){
  assert.equal(result.status,'ok');assert.deepEqual(result.jobs.map(j=>j.title),['Agent a1','Agent a2','Agent a3','Agent a4']);
  assert.equal(await s.page.evaluate(()=>document.querySelector('.job-detail-container').scrollTop),0);
  assert.equal(await s.page.evaluate(()=>window.contacted),false);
 }else assert.equal(result.status,mode==='unchanged'?'repeated_page':'challenge');
});

for(const mode of ['transient','missing','replaced','extra','exited'])test(`native BOSS bound inventory ${mode} preserves ownership`,async t=>{
 const s=await setup(t),list=await s.driver.listing(url);let reads=0;
 s.setInventory(()=>{reads++;if(reads===1||mode==='missing'){if(mode==='exited')s.exitSession();return [];}const tab={windowId:'owned-window',tabId:mode==='replaced'?'replacement':'owned-tab',url:s.page.url()};return mode==='extra'?[tab,{...tab,tabId:'extra'}]:[tab];});
 const result=await s.driver.detail(list.jobs[0]);assert.equal(result.status,{transient:'ok',missing:'browser_closed',replaced:'browser_closed',extra:'unexpected_browser_tab',exited:'browser_closed'}[mode]);
 if(mode==='transient'){assert.equal(result.job.description,jd('a1'));assert.equal(s.counts().closes,0);}else assert.equal(result.job,undefined);
 // The driver opens the homepage and types the query rather than navigating to
 // the results address, so the first request is the homepage. See
 // china/search-box.mjs for what the site measures.
 assert.deepEqual(s.requests,['/web/user/','/web/geek/jobs']);
});
