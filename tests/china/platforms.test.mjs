import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { jobIdentity, searchUrl, validateSearchUrl, extractPage } from '../../china/platforms.mjs';

test('identity removes tracking without collapsing different requisitions or platforms', () => {
  assert.deepEqual(jobIdentity('boss', 'https://www.zhipin.com/job_detail/abc123.html?securityId=foo'),
    { id:'abc123', key:'boss:abc123', url:'https://www.zhipin.com/job_detail/abc123.html' });
  assert.equal(jobIdentity('liepin','https://www.liepin.com/job/123456.shtml?mscid=xx').key,'liepin:job-123456');
  assert.equal(jobIdentity('liepin','https://www.liepin.com/a/123456.shtml').key,'liepin:a-123456');
});
test('only HTTPS platform hosts and recognized job paths are accepted', () => {
  for (const url of ['https://www.zhipin.com.evil.test/job_detail/123.html','http://www.zhipin.com/job_detail/123.html','https://u:p@www.zhipin.com/job_detail/123.html','https://www.zhipin.com:444/job_detail/123.html','https://www.zhipin.com/job_detail/../x']) {
    assert.throws(()=>jobIdentity('boss',url));
  }
  assert.throws(()=>jobIdentity('other','https://www.zhipin.com/job_detail/123.html'));
});
test('search encodes literal queries and preserves caller-selected search filters', () => {
  assert.equal(new URL(searchUrl('boss','Agent & RAG')).searchParams.get('query'),'Agent & RAG');
  assert.equal(new URL(searchUrl('liepin','Agent')).searchParams.get('key'),'Agent');
  assert.equal(validateSearchUrl('boss','https://www.zhipin.com/web/geek/job?query=Agent&city=101010100'), 'https://www.zhipin.com/web/geek/job?query=Agent&city=101010100');
  assert.throws(()=>validateSearchUrl('boss','https://www.zhipin.com/web/geek/chat'));
});

let browser;
before(async()=>{ browser=await chromium.launch({channel:process.env.CHINA_TEST_CHANNEL || 'chrome',headless:true}); });
after(async()=>{ await browser?.close(); });
async function read(html,platform,kind='listing') {
  const page=await browser.newPage();
  try { await page.setContent(html); return await page.evaluate(extractPage,{platform,kind}); }
  finally { await page.close(); }
}
test('BOSS card keeps title, salary, company and distinct same-company vacancies',async()=>{
  const r=await read(`<nav>登录/注册</nav><ul class="job-list-box">
  <li class="job-card-wrapper"><a class="job-card-left" href="https://www.zhipin.com/job_detail/aa1.html?lid=x"><span class="job-name">Agent工程师</span><span class="job-area">上海·徐汇区</span><span class="salary">30-50K·16薪</span><ul class="tag-list"><li>3-5年</li><li>本科</li></ul></a><h3 class="company-name">测试公司</h3></li>
  <li class="job-card-wrapper"><a href="https://www.zhipin.com/job_detail/aa2.html"><span class="job-name">Agent工程师</span></a><h3 class="company-name">测试公司</h3></li></ul>`,'boss');
  assert.equal(r.status,'ok'); assert.equal(r.jobs.length,2);
  assert.equal(r.jobs[0].title,'Agent工程师'); assert.equal(r.jobs[0].company,'测试公司');
  assert.equal(r.jobs[0].salaryRaw,'30-50K·16薪'); assert.equal(r.jobs[0].experience,'3-5年'); assert.equal(r.jobs[0].education,'本科');
});
test('Liepin card uses employer field rather than recruiter and preserves ad markers',async()=>{
  const r=await read(`<div class="job-list-item"><div class="job-detail-box"><a href="https://www.liepin.com/job/123.shtml"><div class="job-title">Agent架构师</div><span class="job-dq">杭州</span></a><span class="job-salary">30-60k·15薪</span><div class="job-labels"><span>5-10年</span><span>统招本科</span></div></div><div class="company-name">某互联网公司</div><div class="recruiter-name">张女士·猎头顾问</div><span>广告</span></div>`,'liepin');
  assert.equal(r.jobs[0].company,'某互联网公司'); assert.equal(r.jobs[0].title,'Agent架构师'); assert.equal(r.jobs[0].advertised,true);
});
test('domestic listing extraction excludes foreign hosts before native identity signatures',async()=>{
 for(const [platform,path] of [['boss','/job_detail/123.html'],['liepin','/job/123.shtml']]){
  const r=await read(`<a href="https://evil.test${path}">外链</a>`,platform);
  assert.equal(r.jobs.length,0);
 }
});
test('current Liepin hashed layout extracts leaf labels without folding ad badges into salary',async()=>{
  const r=await read(`<div><div class="job-detail-box"><a data-nick="job-detail-job-info" href="https://www.liepin.com/job/123.shtml"><div><div title="招聘Agent开发">Agent开发</div><div><span>【</span><span>上海</span><span>】</span></div><span>急聘</span><span>20-40k·15薪</span></div><div><span>3-5年</span><span>统招本科</span></div></a><div data-nick="job-detail-company-info"><span class="ellipsis-1">示例公司</span></div></div><div>广告</div></div>`,'liepin');
  assert.equal(r.jobs[0].salaryRaw,'20-40k·15薪');assert.equal(r.jobs[0].experience,'3-5年');assert.equal(r.jobs[0].education,'统招本科');
  assert.equal(r.jobs[0].location,'上海');
});
test('bracketed JD headings are never interpreted as a location',async()=>{
  for(const platform of ['boss','liepin']) {
    const description='【任职要求】负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。要求熟悉后端开发与分布式系统。';
    const r=await read(`<h1>Agent工程师</h1><div class="${platform==='boss'?'job-sec-text':'job-description'}">${description}</div>`,platform,'detail');
    assert.equal(r.status,'ok');assert.equal(r.job.description,description);
    assert.equal(r.job.location,'',platform);
  }
});
test('Liepin location fallback reads a separate city block, never a bracket inside the title',async()=>{
  for(const title of ['大模型算法专家【世界500强企业】','大模型评测工程师【垂类大模型】','多模态大模型评测-杭州【AGI专项】','【AGI专项】']) {
    for(const city of ['【杭州】','【<br>杭州<br>】','']) {
      const r=await read(`<div class="job-detail-box"><a href="https://www.liepin.com/job/123.shtml"><div title="招聘${title}">${title}</div><div>${city}</div><span>30-60k</span></a></div>`,'liepin');
      assert.equal(r.jobs[0].location,city?'杭州':'',`${title}: ${city}`);
    }
  }
});
test('Liepin ambiguous bracket locations remain unknown and explicit location has priority',async()=>{
  for(const explicit of ['', '<span class="job-dq">上海</span>']) {
    const r=await read(`<div class="job-detail-box"><a href="https://www.liepin.com/job/123.shtml"><div class="job-title">AI工程师</div><div>【杭州】</div><div>【南京】</div>${explicit}</a></div>`,'liepin');
    assert.equal(r.jobs[0].location,explicit?'上海':'');
  }
});
test('detail archives full JD even when navigation has a login link',async()=>{
  const r=await read(`<nav>登录/注册</nav><div class="job-banner"><h1>Agent工程师</h1><span class="salary">30-50K</span></div><div class="job-sec-text">职责：构建 Agent Runtime。\n要求：掌握幂等、重试、状态管理和评测。负责服务上线、运行监控及回归验证。</div>`,'boss','detail');
  assert.equal(r.status,'ok'); assert.match(r.job.description,/回归验证/);
  assert.equal(r.job.title,'Agent工程师');
});
test('challenge and explicit closed page override apparent job content; missing JD is not closed',async()=>{
  assert.equal((await read('<h1>安全验证</h1><p>请完成验证后继续访问</p>','boss')).status,'challenge');
  assert.equal((await read('<h1>登录后查看完整职位</h1><input placeholder="手机号">','liepin','detail')).status,'login_required');
  assert.equal((await read('<h1>职位已下线</h1><div class="job-sec-text">旧职位正文不应被视为有效岗位</div>','boss','detail')).status,'closed');
  assert.equal((await read('<nav>首页 登录/注册</nav>','liepin','detail')).status,'extraction_failed');
  assert.equal((await read('<div>暂无符合条件的职位</div>','boss')).status,'empty');
});
test('every platform synonym for a withdrawn posting is closed, not a read failure',async()=>{
  // Liepin says "暂停招聘" where BOSS says "已下线". Treating the Liepin wording
  // as unreadable leaves the job sitting in the queue forever and re-reads it
  // on every round, so the notice has to be recognised as the terminal state it
  // is. Each case keeps unrelated job text around to prove the notice wins.
  const notices=[
    ['boss','detail','职位已下线'],
    ['boss','detail','该职位已关闭'],
    ['boss','detail','职位已停止招聘'],
    ['liepin','detail','该职位已暂停招聘'],
    ['liepin','detail','职位已暂停'],
    ['liepin','detail','该职位已下线'],
  ];
  for(const [platform,kind,notice] of notices){
    const html=`<div class="job-detail-box"><h1>Agent工程师</h1><p>${notice}</p><div class="job-sec-text">负责构建数据管道、服务端接口与监控告警，支撑线上业务稳定运行。要求熟悉后端开发与分布式系统设计。</div></div>`;
    const result=await read(html,platform,kind);
    assert.equal(result.status,'closed',`${platform}: ${notice}`);
    assert.equal(result.job,undefined,`${platform} must not archive a withdrawn posting`);
  }
  // Liepin appends a recommendation prompt to the same line as the notice.
  const shared=await read('<div class="job-apply-container"></div><p>该职位已暂停招聘，投递了该职位的人还查看了以下职位，快去看看吧</p>','liepin','detail');
  assert.equal(shared.status,'closed');
  assert.equal(shared.evidence.quote,'职位已暂停招聘');
});
test('an ordinary mention of pausing inside a live JD is not a closure',async()=>{
  // The closure notice is a standalone page state, not a phrase in the body.
  const description='岗位职责：负责大模型推理服务的稳定性建设；当上游流量异常时能够安全地暂停招聘系统的批处理任务并恢复，保障线上服务不中断。要求熟悉分布式系统与可观测性建设。';
  const result=await read(`<div class="job-apply-container"><h1>大模型平台工程师</h1></div><div class="job-intro-container"><div data-selector="job-intro-content">${description}</div></div>`,'liepin','detail');
  assert.equal(result.status,'ok');
  assert.equal(result.job.description,description);
});
test('font-encoded salary is flagged and never guessed; hidden JD is not collected',async()=>{
  const r=await read('<h1>工程师</h1><span class="salary">\ue031-\ue032K</span><div class="job-sec-text">职责：开发生产服务、监控、告警、系统设计和故障排查。要求能够说明架构决策及结果。</div>','boss','detail');
  assert.equal(r.job.salaryRaw,'\ue031-\ue032K'); assert.ok(r.job.qualityFlags.includes('encoded_salary'));
  assert.equal((await read('<h1>工程师</h1><div class="job-sec-text" style="display:none">秘密正文</div>','boss','detail')).status,'extraction_failed');
});
test('a visible login gate outside the JD makes a long preview incomplete',async()=>{
  const html='<h1>Agent工程师</h1><div class="job-sec-text">负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。这里仅为截断预览，实际正文需要登录查看。</div><div>登录查看完整内容</div>';
  const result=await read(html,'boss','detail');
  assert.equal(result.status,'login_required');assert.equal(result.job,undefined);
});

test('ordinary security terminology in a job title or JD is not a challenge prompt',async()=>{
  const description='岗位职责：负责智能体安全验证、权限控制与工具调用审计，研究人机验证方案和访问异常处理，构建评测体系并支持生产部署。要求熟悉后端开发与应用安全。';
  const result=await read(`<h1>安全验证工程师</h1><div class="job-sec-text">${description}</div>`,'boss','detail');
  assert.equal(result.status,'ok');assert.equal(result.job.description,description);
});

test('a separate verification banner still blocks an otherwise complete-looking JD',async()=>{
  const description='岗位职责：负责智能体工具调用、权限控制与应用审计，构建评测体系并支持生产环境部署。要求熟悉后端开发与分布式系统。';
  for(const prompt of ['安全验证','人机验证：请稍候','访问异常，请稍后重试','访问过于频繁，请稍后再试','请进行安全验证','您的访问过于频繁，请稍后再试','安全验证中，请稍候']){
    const result=await read(`<h1>Agent工程师</h1><div class="job-sec-text">${description}</div><div role="dialog">${prompt}</div>`,'boss','detail');
    assert.equal(result.status,'challenge',prompt);assert.equal(result.job,undefined);
  }
});
test('Liepin shared ellipsis class on city and title does not hide the city block',async()=>{
 const r=await read(`<div class="job-detail-box"><a href="https://www.liepin.com/job/123.shtml"><div><div class="ellipsis-1" title="招聘AI工程师【AGI专项】">AI工程师【AGI专项】</div><div><span>【</span><span class="ellipsis-1">南京-栖霞区</span><span>】</span></div></div><span>20-40k</span></a></div>`,'liepin');
 assert.equal(r.jobs[0].title,'AI工程师【AGI专项】');assert.equal(r.jobs[0].location,'南京-栖霞区');
});
test('BOSS standalone details read their own sidebar employer and workplace, never recommendations',async()=>{
 const page=await browser.newPage();try{
 await page.setContent('<div class="job-banner"><h1>AI研发</h1><span class="salary">12-15K</span><a class="text-city">福州</a><span class="text-experiece">3-5年</span><span class="text-degree">本科</span></div><div class="sider-company"><div class="company-info">华苏科技</div><p>1000-9999人</p></div><div class="job-sec-text">负责大模型算法研发、系统部署、模型评测和性能优化；要求熟悉Python以及机器学习基础，能够完成项目上线。</div><div class="job-location">福州鼓楼区园区1<br>点击查看地图</div><div class="recommend"><div class="company-name">其他公司</div><div class="job-location">北京</div></div>');
 const r=await page.evaluate(extractPage,{platform:'boss',kind:'detail'});assert.equal(r.status,'ok');assert.equal(r.job.company,'华苏科技');assert.equal(r.job.location,'福州鼓楼区园区1');assert.equal(r.job.experience,'3-5年');assert.equal(r.job.education,'本科');
 }finally{await page.close();}
});

test('short visible Liepin JD is source insufficiency, not a broken extractor',async()=>{
  const text='通过应用AI帮助企业各个环节提效';
  const r=await read(`<div class="job-apply-container"><h1>AI应用工程师</h1><div class="job-properties"><span>南京</span></div></div><div class="job-intro-container"><div data-selector="job-intro-content">${text}</div></div>`,'liepin','detail');
  assert.equal(r.status,'source_insufficient');assert.equal(r.job.description,text);assert.equal(r.job.title,'AI应用工程师');
});
test('a short but genuinely posted BOSS JD is source insufficiency, not a read failure',async()=>{
  // Headhunter postings on BOSS are sometimes one line long. That is the source
  // being thin, not the extractor failing: recording it as extraction_failed
  // re-reads the identical page on every round and the job never leaves the queue.
  const description='智驾端到端大模型 规控端到端 感知端到端';
  const r=await read(`<div class="job-banner"><h1>智驾端到端大模型</h1><span class="salary">40-70K</span></div><div class="job-sec-text">${description}</div>`,'boss','detail');
  assert.equal(r.status,'source_insufficient');
  assert.equal(r.job.description,description);
  assert.equal(r.job.title,'智驾端到端大模型');
});
test('a page with no JD section at all is a read failure, never source insufficiency',async()=>{
  // The platform home page has no JD container. Calling that a thin source
  // would archive the home page as if it were a posting.
  const r=await read('<div class="job-banner"><h1>BOSS直聘</h1></div>','boss','detail');
  assert.equal(r.status,'extraction_failed');
});
test('empty or loading Liepin description still fails; short unbound fragments are not JDs',async()=>{
 for(const text of ['', '加载中...']){const r=await read(`<div class="job-apply-container"><h1>AI工程师</h1></div><div class="job-intro-container"><div data-selector="job-intro-content">${text}</div></div>`,'liepin','detail');assert.equal(r.status,'extraction_failed');}
 assert.equal((await read('<h1>AI工程师</h1><div class="job-description">短片段</div>','liepin','detail')).status,'extraction_failed');
});
