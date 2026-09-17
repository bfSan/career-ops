import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../../china/collector.mjs';
import { openStore } from '../../china/store.mjs';
import { chromium } from 'playwright';
import { createBrowserDriver } from '../../china/browser.mjs';

// Handwritten DOM fixture based on BOSS v6729 JobCard / JobCardDetail.
// All requests are fulfilled locally; no account or live platform is involved.
const jd=id=>`${id}：【任职要求】负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。要求能够解释系统架构决策与故障恢复流程。`;
const panel=(id,extra='')=>`<div class="job-detail-box"><div class="job-detail-header"><span class="job-name">Agent工程师</span><span class="job-salary">30-50K</span></div><div class="job-detail-body"><p class="desc">${jd(id)}</p>${extra}<a class="more-job-btn" href="/job_detail/${id}.html?securityId=fixture">查看更多信息</a><a class="op-btn-chat" onclick="window.sent=true">立即沟通</a></div></div>`;
function fixture(mode='normal') {
  return `<div class="job-list-container">${['a1','a2'].map(id=>`<div class="job-card-wrap ${id==='a1'?'active':''}"><li class="job-card-box" data-id="${id}"><a class="job-name" href="/job_detail/${id}.html">Agent工程师</a><div class="job-card-footer"><span class="boss-name">测试公司</span><span class="company-location">上海</span></div></li></div>`).join('')}</div><div class="job-detail-container">${panel('a1')}</div><button class="next" disabled>下一页</button>
  <script>
  window.sent=false;window.selected=[];
  document.querySelectorAll('.job-name[href]').forEach(a=>a.onclick=e=>e.preventDefault());
  document.querySelectorAll('.job-card-box').forEach(card=>card.onclick=()=>{
    if(card.classList.contains('is-close')){document.body.insertAdjacentHTML('beforeend','<p>该职位已关闭</p>');return;}
    const id=card.dataset.id;window.selected.push(id);
    if(${JSON.stringify(mode)}==='navigate'){location.href=card.querySelector('a').href;return;}
    document.querySelectorAll('.job-card-wrap').forEach(w=>w.classList.toggle('active',w===card.parentElement));
    const box=document.querySelector('.job-detail-container');
    // Keep the previous JD visible while the loading indicator is present.
    box.insertAdjacentHTML('afterbegin','<div class="job-detail-loading">加载中</div>');
    setTimeout(()=>{
      box.innerHTML=${JSON.stringify(mode==='stale'?panel('a1'):panel('a2',mode==='login'?'<div>登录查看完整内容</div>':''))};
      if(${JSON.stringify(mode)}==='title')box.querySelector('.job-name').textContent='另一个岗位';
      if(${JSON.stringify(mode)}==='identity')box.querySelector('.more-job-btn').remove();
      if(${JSON.stringify(mode)}==='inactive')card.parentElement.classList.remove('active');
      if(${JSON.stringify(mode)}==='closed')box.querySelector('.desc').textContent='该职位已关闭';
      if(${JSON.stringify(mode)}==='challenge')box.innerHTML='<p>请进行安全验证</p>';
    },350);
  });
  </script>`;
}
async function setup(t,mode) {
  const browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL||'chrome',headless:true});
  t.after(()=>browser.close());const context=await browser.newContext();const requests=[];
  await context.route('**/*',r=>{requests.push(new URL(r.request().url()).pathname);return r.fulfill({contentType:'text/html; charset=utf-8',body:fixture(mode)});});
  const driver=await createBrowserDriver({platform:'boss',context,delayMs:0,timeoutMs:900});
  const listing=await driver.listing('https://www.zhipin.com/web/geek/jobs?query=Agent');
  assert.equal(listing.status,'ok');
  return {context,driver,listing,requests};
}
test('BOSS selects in-page JD by ID, waits through stale loading, and never contacts or navigates to detail',async t=>{
  const {context,driver,listing,requests}=await setup(t,'normal');
  assert.equal(listing.jobs.length,2);assert.equal(listing.jobs[1].company,'测试公司');
  assert.equal(listing.jobs[1].location,'上海');
  const first=await driver.detail(listing.jobs[0]);assert.equal(first.status,'ok');assert.equal(first.job.description,jd('a1'));
  const second=await driver.detail(listing.jobs[1]);assert.equal(second.status,'ok');assert.equal(second.job.description,jd('a2'));
  assert.equal(context.pages().length,1);
  assert.deepEqual(requests,['/web/geek/jobs']);
  assert.deepEqual(await context.pages()[0].evaluate(()=>({sent:window.sent,selected:window.selected})),{sent:false,selected:['a2']});
  assert.equal((await driver.next()).status,'end');
  await driver.close();assert.equal(context.pages().length,0);
});
for(const [mode,status] of [['stale','extraction_failed'],['title','extraction_failed'],['identity','extraction_failed'],['inactive','extraction_failed'],['login','login_required'],['closed','closed'],['challenge','challenge'],['navigate','extraction_failed']]) {
  test(`BOSS panel rejects ${mode} without opening a standalone detail`,async t=>{
    const {driver,listing,requests}=await setup(t,mode);
    assert.equal((await driver.detail(listing.jobs[1])).status,status);
    assert.deepEqual(requests,['/web/geek/jobs']);
  });
}
test('BOSS missing card fails without a fallback navigation',async t=>{
  const {driver,requests}=await setup(t,'normal');
  assert.equal((await driver.detail({url:'https://www.zhipin.com/job_detail/missing.html',title:'Agent工程师'})).status,'extraction_failed');
  assert.deepEqual(requests,['/web/geek/jobs']);
});

test('BOSS panel collection archives matching IDs and resumes without duplicating an earlier JD',async t=>{
  const {driver,context}=await setup(t,'normal');
  const root=mkdtempSync(join(tmpdir(),'boss-panel-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const options={root,platform:'boss',searchUrl:'https://www.zhipin.com/web/geek/jobs?query=Agent',driver};
  const first=await collect({...options,limit:1});
  assert.equal(first.completed,1);assert.equal(first.reason,'job_limit');
  const second=await collect({...options,resume:true,maxPages:2});
  assert.equal(second.completed,2);assert.equal(second.status,'exhausted');
  const state=openStore(root);
  for(const id of ['a1','a2']) {
    const job=state.jobs[`boss:${id}`];
    assert.equal(job.versions.length,1);assert.equal(job.latest.description,jd(id));
    const archived=readFileSync(join(root,job.latest.capturePath),'utf8');
    assert.ok(archived.includes(`**Job ID:** ${id}`));assert.ok(archived.includes(jd(id)));
    assert.equal(job.latest.company,'测试公司');
    assert.equal(job.latest.location,'上海');
    assert.ok(archived.includes('**Location:** 上海'));
  }
  assert.equal(await context.pages()[0].evaluate(()=>window.sent),false);
});

test('BOSS closed list card is recorded without clicking or requiring a replacement panel',async t=>{
  const {driver,context,listing}=await setup(t,'normal');
  await context.pages()[0].evaluate(()=>document.querySelectorAll('.job-card-box')[1].classList.add('is-close'));
  assert.equal((await driver.detail(listing.jobs[1])).status,'closed');
  assert.deepEqual(await context.pages()[0].evaluate(()=>window.selected),[]);
});

test('BOSS explicit login gate outside the panel blocks an otherwise complete-looking JD',async t=>{
  const {driver,context,listing}=await setup(t,'normal');
  await context.pages()[0].evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="dialog">登录查看完整内容</div>'));
  assert.equal((await driver.detail(listing.jobs[0])).status,'login_required');
});
