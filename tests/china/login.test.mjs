import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {prepareLoginPage,loginOutcome} from '../../china/login.mjs';
async function setup(t,body,fail=false){
 const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
 const context=await browser.newContext();
 await context.route('**/*',r=>fail?r.abort():r.fulfill({contentType:'text/html; charset=utf-8',body}));
 const page=await context.newPage();return{page,context};
}
const options={platform:'boss',url:'https://www.zhipin.com/web/user/',timeoutMs:2000,settleMs:100};
test('login does not announce readiness or save a blank HTTP-200 page',async t=>{
 const {page}=await setup(t,'<html><body></body></html>');
 const session=await prepareLoginPage({page,...options});assert.equal(session.status,'blank_page');session.dispose();
});
test('login distinguishes a loading shell from an usable login page',async t=>{
 const {page}=await setup(t,'<p>加载中，请稍后</p>');
 const session=await prepareLoginPage({page,...options});assert.equal(session.status,'page_not_ready');session.dispose();
});
test('login reports navigation failure instead of inviting the user to log in',async t=>{
 const {page}=await setup(t,'',true);
 const session=await prepareLoginPage({page,...options});assert.equal(session.status,'network_error');session.dispose();
});
test('readable login content with a blank iframe is ready but pressing Enter does not verify authentication',async t=>{
 const {page}=await setup(t,'<p>验证码登录</p><input name="phone"><iframe src="about:blank"></iframe>');
 const session=await prepareLoginPage({page,...options});assert.equal(session.status,'ready');
 assert.equal((await session.complete()).status,'login_required');session.dispose();
});
test('login detects a late main-frame blank and completes the waiting operation without Enter',async t=>{
 const {page}=await setup(t,'<p>验证码登录</p>');
 const session=await prepareLoginPage({page,...options});assert.equal(session.status,'ready');
 await page.goto('about:blank').catch(()=>{});
 const result=await session.closed;assert.equal(result.status,'blank_page');session.dispose();
});
test('login only reports authentication after a successful account response and readable page',async t=>{
 const {page,context}=await setup(t,'<p>个人中心</p><script>fetch("/wapi/zpuser/wap/getUserInfo.json")</script>');
 await context.route('**/getUserInfo.json',r=>r.fulfill({json:{code:0,zpData:{privateField:'never-log'}}}));
 const events=[];const session=await prepareLoginPage({page,...options,onEvent:e=>events.push(e)});
 assert.equal(session.status,'ready');assert.equal((await session.complete()).status,'authenticated');
 assert.equal(JSON.stringify(events).includes('never-log'),false);session.dispose();
});

test('an earlier authenticated response never confirms a current verification page',async t=>{
 const {page,context}=await setup(t,'<p>个人中心</p><script>fetch("/wapi/zpuser/wap/getUserInfo.json")</script>');
 await context.route('**/getUserInfo.json',r=>r.fulfill({json:{code:0}}));
 const session=await prepareLoginPage({page,...options});assert.equal(session.status,'ready');
 await context.route('**/security.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>安全验证</h1>'}));
 await page.goto('https://www.zhipin.com/web/passport/zp/security.html');
 assert.equal((await session.complete()).status,'challenge');session.dispose();
});

test('Liepin can preserve a readable session without falsely claiming verified authentication',async t=>{
 const {page}=await setup(t,'<p>个人中心</p>');
 const session=await prepareLoginPage({page,...options,platform:'liepin',url:'https://www.liepin.com/zhaopin/'});
 assert.equal(session.status,'ready');
 const result=await session.complete();assert.equal(result.status,'session_unverified');
 const outcome=loginOutcome('liepin',result.status);
 assert.equal(outcome.exitCode,0);assert.equal(outcome.result.status,'session_unverified');session.dispose();
});
