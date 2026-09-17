import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createBrowserDriver } from '../../china/browser.mjs';
import { guardNavigation } from '../../china/navigation-guard.mjs';

test('BOSS code 37 may finish one automatic verification before listing extraction',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();const served=[];let searches=0;
  try{
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());served.push(url.pathname);
      const verification=url.pathname.includes('security');
      const html=verification
        ? '<p>加载中，请稍候</p><script>setTimeout(()=>location.href="/web/geek/jobs?query=Agent",100)</script>'
        : ++searches===1
          ? '<script>location.href="/web/passport/zp/security.html?code=37"</script>'
          : '<li class="job-card-wrapper"><a href="/job_detail/a1.html"><span class="job-name">Agent工程师</span></a></li>';
      await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    });
    const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:2000});
    const result=await driver.listing('https://www.zhipin.com/web/geek/jobs?query=Agent');
    assert.equal(result.status,'ok');assert.equal(result.jobs.length,1);
    assert.deepEqual(served,['/web/geek/jobs','/web/passport/zp/security.html','/web/geek/jobs']);
    await driver.close();
  }finally{await browser.close();}
});

test('a repeated BOSS code 37 is stopped before another verification script is served',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();const served=[];
  try{
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;served.push(path);
      const target=path.includes('security')?'/web/geek/jobs?query=Agent':'/web/passport/zp/security.html?code=37';
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<script>setTimeout(()=>location.href=${JSON.stringify(target)},50)</script><p>加载中，请稍候</p>`});
    });
    const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:2000});
    assert.equal((await driver.listing('https://www.zhipin.com/web/geek/jobs?query=Agent')).status,'challenge');
    assert.deepEqual(served,['/web/geek/jobs','/web/passport/zp/security.html','/web/geek/jobs']);
    assert.equal((await driver.next()).status,'challenge');await driver.close();
  }finally{await browser.close();}
});

test('an automatic verification that never returns is closed on its deadline',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();let served=0;
  try{
    await context.route('**/*',r=>{served++;return r.fulfill({contentType:'text/html; charset=utf-8',body:'<p>加载中，请稍候</p>'});});
    const page=await context.newPage();
    const guard=await guardNavigation(page,{platform:'boss',automaticVerificationTimeoutMs:200});
    const closed=page.waitForEvent('close',{timeout:1500});
    await page.goto('https://www.zhipin.com/web/passport/zp/security.html?code=37').catch(()=>{});
    await closed;assert.equal(served,1);assert.equal(guard.result().status,'challenge');
  }finally{await browser.close();}
});

test('a second verification commit without a request callback stops immediately',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();let served=0;
  try{
    await context.route('**/*',r=>{served++;return r.fulfill({contentType:'text/html; charset=utf-8',body:'<p>加载中，请稍候</p><script>setTimeout(()=>history.replaceState({},"","?code=37&attempt=2"),100)</script>'});});
    const page=await context.newPage();
    const guard=await guardNavigation(page,{platform:'boss',automaticVerificationTimeoutMs:5000});
    const closed=page.waitForEvent('close',{timeout:1500});
    await page.goto('https://www.zhipin.com/web/passport/zp/security.html?code=37');
    await closed;assert.equal(served,1);assert.equal(guard.result().status,'challenge');
  }finally{await browser.close();}
});

test('manual login allows one verification page but closes rapid redirect loops',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();
  try {
    await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>安全验证</h1>'}));
    const page=await context.newPage();const guard=await guardNavigation(page,{platform:'boss',allowChallenge:true});
    await page.goto('https://www.zhipin.com/web/passport/zp/security.html');
    assert.equal(guard.result(),null);assert.equal(page.isClosed(),false);
    const closed=page.waitForEvent('close',{timeout:2000});
    await page.evaluate(()=>{let n=0;setInterval(()=>history.replaceState({},'',`?step=${++n}`),20);});
    await closed;assert.equal(guard.result().status,'navigation_loop');
  }finally{await browser.close();}
});

test('security redirect stops the page before its refresh script can run',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();const served=[];
  try {
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;served.push(path);
      const target=path.includes('security')?'/web/geek/jobs?query=Agent':'/web/passport/zp/security.html';
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<script>setTimeout(()=>location.href=${JSON.stringify(target)},20)</script><p>加载中，请稍候</p>`});
    });
    const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:1500});
    const result=await driver.listing('https://www.zhipin.com/web/geek/jobs?query=Agent');
    assert.equal(result.status,'challenge');
    assert.deepEqual(served,['/web/geek/jobs']);
    assert.equal((await driver.next()).status,'challenge');
    await driver.close();assert.equal(context.pages().length,0);
  }finally{await browser.close();}
});
test('a late list-side challenge stops the entire scan before the next detail request',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();const served=[];
  try{
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;served.push(path);
      await route.fulfill({contentType:'text/html; charset=utf-8',body:path.includes('job_detail')?'<h1>Agent工程师</h1><div class="job-sec-text">负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。要求能够解释系统架构决策与故障恢复流程。</div>':'<div class="job-card-wrap"><li class="job-card-box"><a class="job-name" href="/job_detail/a1.html"><span class="job-name">Agent工程师</span></a></li></div><script>setTimeout(()=>location.href="/web/passport/zp/security.html",150)</script>'});
    });
    const driver=await createBrowserDriver({platform:'boss',context,delayMs:400,timeoutMs:1500});
    const listing=await driver.listing('https://www.zhipin.com/web/geek/jobs?query=Agent');
    assert.equal(listing.status,'ok');
    assert.equal((await driver.detail(listing.jobs[0])).status,'challenge');
    assert.deepEqual(served,['/web/geek/jobs']);
    await driver.close();assert.equal(context.pages().length,0);
  }finally{await browser.close();}
});

test('Liepin navigates lists and details without clicking contact; next waits for new cards',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();
  try {
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      let html;
      if(url.pathname.includes('/job/')) html='<h1>Agent工程师</h1><div class="job-description">负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。要求能够解释系统架构决策与故障恢复流程。</div><button onclick="document.body.innerHTML=\'SENT\'">立即沟通</button>';
      else html=`<li class="job-card-wrapper"><a href="/job/${url.searchParams.has('page')?'2':'1'}.shtml"><span class="job-name">Agent工程师</span></a><span class="company-name">测试</span></li>${url.searchParams.has('page')?'<button class="next" disabled>下一页</button>':'<a class="next" href="?key=Agent&page=2">下一页</a>'}`;
      await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    });
    const driver=await createBrowserDriver({platform:'liepin',context,delayMs:0,timeoutMs:1500});
    const first=await driver.listing('https://www.liepin.com/zhaopin/?key=Agent',0);
    assert.equal(first.jobs.length,1);
    assert.equal((await driver.detail(first.jobs[0])).status,'ok');
    const second=await driver.next();assert.match(second.jobs[0].url,/2\.shtml/);
    assert.equal((await driver.next()).status,'end');
    await driver.close();assert.equal(context.pages().length,0);
  }finally{await browser.close();}
});
test('a changed job URL cannot attach another posting JD to the requested ID',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext();
  try {
    await context.route('**/*',async route=>{
      // An HTTP redirect escapes Playwright's route handler after its first URL.
      // Simulate an SPA redirect entirely locally instead of contacting a live site.
      if(new URL(route.request().url()).pathname.includes('/zhaopin'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="/job/1.shtml">Agent工程师</a>'});
      await route.fulfill({contentType:'text/html; charset=utf-8',body:'<script>history.replaceState({}, "", "/job/2.shtml")</script><h1>其他岗位</h1><div class="job-description">负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。要求能够解释系统架构决策与故障恢复流程。</div>'});
    });
    const driver=await createBrowserDriver({platform:'liepin',context,delayMs:0,timeoutMs:1500});
    const list=await driver.listing('https://www.liepin.com/zhaopin/?key=Agent');
    assert.equal((await driver.detail(list.jobs[0])).status,'extraction_failed');
    await driver.close();
  }finally{await browser.close();}
});

test('a main-frame blank redirect stops both login and scan while blank child frames are allowed',async()=>{
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  try {
    for(const allowChallenge of [true,false]) {
      const context=await browser.newContext();
      await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<p>验证码登录</p><iframe src="about:blank"></iframe>'}));
      const page=await context.newPage();const guard=await guardNavigation(page,{platform:'boss',allowChallenge});
      await page.goto('https://www.zhipin.com/web/user/');assert.equal(guard.result(),null);
      await page.goto('about:blank').catch(()=>{});
      assert.equal(guard.result()?.status,'blank_page');
      await context.close();
    }
  }finally {await browser.close();}
});
