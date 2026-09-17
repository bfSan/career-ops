import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createBrowserDriver} from '../../china/browser.mjs';
const target='https://www.zhipin.com/web/geek/jobs?query=Agent';
const card='<li class="job-card-wrapper"><a href="/job_detail/a1.html"><span class="job-name">Agent工程师</span></a></li>';

for(const delayed of [false,true]) {
  test(`a committed search survives goto interruption when DOM is ${delayed?'still loading':'already ready'}`,async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
      const context=await browser.newContext();let requests=0;const events=[];
      await context.route('**/*',route=>{requests++;return route.fulfill({contentType:'text/html; charset=utf-8',body:delayed?`<p>加载中</p><script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(card)},300)</script>`:card});});
      const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:1500,onEvent:e=>events.push(e)});
      const page=context.pages()[0];const goto=page.goto.bind(page);
      page.goto=async(...args)=>{await goto(...args);throw new Error('net::ERR_ABORTED https://www.zhipin.com/?secret=do-not-log');};
      const result=await driver.listing(target);
      assert.equal(result.status,'ok');assert.equal(result.jobs[0].title,'Agent工程师');assert.equal(requests,1);
      assert.ok(events.some(e=>e.event==='navigation_error' && e.documentCommitted===true));
      assert.ok(!JSON.stringify(events).includes('do-not-log'));
      await driver.close();
    }finally {await browser.close();}
  });
}

test('a failure before a new document commits cannot reuse an old matching search page',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext();
    await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:card}));
    const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:1000});
    const page=context.pages()[0];await page.goto(target);
    page.goto=async()=>{throw new Error('net::ERR_CONNECTION_RESET');};
    assert.equal((await driver.listing(target)).status,'network_error');
    await driver.close();
  }finally {await browser.close();}
});

test('an old document changing its URL with replaceState is not a committed navigation',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext();
    await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:card}));
    const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:1000});
    const page=context.pages()[0];await page.goto('https://www.zhipin.com/web/geek/jobs?query=old');
    page.goto=async()=>{await page.evaluate(url=>history.replaceState(null,'',url),target);throw new Error('net::ERR_ABORTED');};
    assert.equal((await driver.listing(target)).status,'network_error');
    await driver.close();
  }finally {await browser.close();}
});
