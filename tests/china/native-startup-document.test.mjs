import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createNativeDriver} from '../../china/native-driver.mjs';

for(const platform of ['boss','liepin']){
  async function setup(t,{initial='blank',commit=true}={}){
    const search=platform==='boss'?'https://www.zhipin.com/web/geek/jobs?city=101020100&query=AI':'https://www.liepin.com/zhaopin/?city=020&dq=020&key=AI';
    const body=platform==='boss'?'<div class="job-list-container"><div class="job-card-wrap"><li class="job-card-box"><a class="job-name" href="/job_detail/0123456789abcdef.html">AI工程师</a><span class="company-name">测试</span></li></div></div>':'<li class="job-card-wrapper"><a href="/job/101.shtml">AI工程师</a><span class="company-name">测试</span></li>';
    const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
    const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body}));
    let first=true,launches=0,navigations=0,closes=0;
    // Successful page commits share Chromium with the full parallel test suite.
    // Keep the intentionally never-committing case short; do not time successful
    // OS/renderer scheduling against a 200ms negative-test budget.
    const driver=await createNativeDriver({root:'/unused-test-root',platform,delayMs:0,timeoutMs:commit?5000:200,pollMs:5,
      sessionFactory:async()=>{launches++;if(initial==='other')await page.goto(search.replace('AI','other'));return {closed:new Promise(()=>{}),close:async()=>{closes++;}};},
      bridgeFactory:async()=>({
        // Chrome's address bar can lead the committed document during launch.
        tabs:async()=>[{windowId:'owned',tabId:'owned',url:first||!commit?search:page.url()}],
        evaluate:async(_tab,source)=>{const result=JSON.parse(await page.evaluate(source));if(first&&commit){first=false;await page.goto(search);}return result;},
        navigate:async(_tab,url)=>{navigations++;await page.goto(url);},
      }),
    });t.after(()=>driver.close());
    return {driver,page,search,counts:()=>({launches,navigations,closes})};
  }
  test(`${platform}: wait for the first committed document when address bar is ready but DOM is blank`,async t=>{
    const s=await setup(t),result=await s.driver.listing(s.search);
    assert.equal(result.status,'ok');assert.equal(result.jobs.length,1);
    assert.deepEqual(s.counts(),{launches:1,navigations:0,closes:0});
    // After the initial list is bound, an unexpected blank page still stops.
    await s.page.goto('about:blank');
    assert.equal((await s.driver.detail(result.jobs[0])).status,'blank_page');
    assert.equal(s.counts().closes,1);
  });
  test(`${platform}: an initial nonblank wrong-query document is still rejected`,async t=>{
    const s=await setup(t,{initial:'other'}),result=await s.driver.listing(s.search);
    assert.equal(result.status,platform==='boss'?'navigation_changed':'identity_mismatch');
    assert.equal(s.counts().navigations,0);
  });
  test(`${platform}: a startup document that stays blank cannot produce jobs`,async t=>{
    const s=await setup(t,{commit:false}),result=await s.driver.listing(s.search);
    assert.notEqual(result.status,'ok');assert.equal(result.jobs,undefined);
    assert.equal(s.counts().launches,1);assert.equal(s.counts().navigations,0);
  });
}
