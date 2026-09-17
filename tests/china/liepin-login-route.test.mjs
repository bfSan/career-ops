import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import * as platforms from '../../china/platforms.mjs';import {createNativeDriver} from '../../china/native-driver.mjs';import {prepareLoginPage} from '../../china/login.mjs';
const auth='https://wow.liepin.com/t1012695/4410f519.html',search='https://www.liepin.com/zhaopin/?key=agent';
test('Liepin default login targets the observed account gate without widening job or search hosts',()=>{
 assert.equal(platforms.loginUrl('liepin'),auth);assert.equal(platforms.validateLoginUrl('liepin',auth).href,auth);
 assert.throws(()=>platforms.jobIdentity('liepin',auth));assert.throws(()=>platforms.validateSearchUrl('liepin',auth));
 for(const u of [auth.replace('https:','http:'),auth.replace('wow.liepin.com','wow.liepin.com.evil.test'),auth.replace('4410f519','unrelated'),'https://user:pass@wow.liepin.com/t1012695/4410f519.html'])assert.throws(()=>platforms.validateLoginUrl('liepin',u));
});
async function fixture(t){const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),requests=[];await page.route('**/*',route=>{const u=new URL(route.request().url());requests.push(u.href);return route.fulfill({contentType:'text/html; charset=utf-8',body:u.hostname==='wow.liepin.com'?'<h1>我要找工作</h1><input><button>获取验证码</button><button>登录/注册</button><p>微信扫码登录</p>':u.pathname.includes('/zhaopin')?'<a href="/job/101.shtml">Agent工程师</a><a href="/job/102.shtml">另一岗位</a>':`<script>location.replace('${auth}')</script>`});});return{page,requests};}
test('the real observed Liepin login redirect stops native collection as login_required',async t=>{
 const {page,requests}=await fixture(t);let closed=0;
 const driver=await createNativeDriver({platform:'liepin',delayMs:0,timeoutMs:800,pollMs:20,sessionFactory:async o=>{await page.goto(o.url);return{closed:new Promise(()=>{}),close:async()=>{closed++;}};},bridgeFactory:async()=>({tabs:async()=>[{windowId:'owned',tabId:'owned',url:page.url()}],evaluate:async(_,s)=>JSON.parse(await page.evaluate(s)),navigate:async(_,u)=>page.goto(u)})});t.after(()=>driver.close());
 const list=await driver.listing(search);assert.equal((await driver.detail(list.jobs[0])).status,'login_required');assert.equal((await driver.detail(list.jobs[1])).status,'login_required');assert.equal(closed,1);assert.equal(requests.some(u=>u.includes('/job/102')),false);
});
test('the explicit Liepin account page is ready for manual login but not authenticated merely by Enter',async t=>{
 const {page}=await fixture(t);const session=await prepareLoginPage({page,platform:'liepin',url:auth,timeoutMs:1500,settleMs:50});t.after(()=>session.dispose());assert.equal(session.status,'ready');assert.equal((await session.complete()).status,'login_required');
});
