#!/usr/bin/env node
// Local, explicit domestic job collection. No messaging, submission or model calls.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { readFileSync, statSync } from 'node:fs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { searchUrl, validateSearchUrl, loginUrl } from './china/platforms.mjs';
import { openStore, queueJobs } from './china/store.mjs';
import {selectBrowserDriver} from './china/driver-choice.mjs';
import { collect } from './china/collector.mjs';
import {loadMarketSelection} from './china/market-workflow.mjs';
import { prepareLoginPage, loginOutcome, openNativeLogin, waitForNativeLogin } from './china/login.mjs';
import { importJobs } from './china/import.mjs';
import { setupProviders } from './china/setup-providers.mjs';
import { fileURLToPath } from 'node:url';

const HELP=`BOSS / 猎聘 / LinkedIn 岗位采集（独立浏览器会话，完整 JD 本地归档）

node china-jobs.mjs login --platform boss|liepin|linkedin
node china-jobs.mjs scan --platform boss|liepin|linkedin --query "Agent" [--limit 5] [--pages 1]
node china-jobs.mjs scan --platform boss|liepin|linkedin --search-url "站内筛选后的搜索URL" [--resume]
node china-jobs.mjs list [--platform boss|liepin|linkedin]
node china-jobs.mjs queue [--platform boss|liepin|linkedin] [--limit 20]
node china-jobs.mjs import --platform boss|liepin|linkedin --file "完整可见JD.json"
node china-jobs.mjs setup-providers [--code-root PATH]

Options:
  --root PATH        私有数据目录，默认遵循 CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR
  --code-root PATH   setup-providers 的代码根，默认当前 career-ops 代码库
  --resume           恢复同一搜索最近未完成的批次；limit/pages 是本次预算
  --refresh          重新读取已归档JD；默认扫描跳过已有完整JD
  --market-plan FILE scan 使用版本绑定的批准清单，要求当前采集政策
  --market-pool FILE queue 只导出已确认符合范围的同版本岗位
  --configuration-hash HASH 与 --market-pool 配对，防止使用错误市场配置
  --limit N          scan 默认5条，可显式设置1–50条
  --pages N          scan 默认1页，可显式设置1–20页；不代表全市场覆盖
  --channel NAME     chrome（默认）、chromium 或 msedge
  --browser-driver N native 或 playwright；macOS BOSS/猎聘/LinkedIn Chrome 默认 native
  --headless         无界面采集；首次登录请用 login
  --delay-ms N       页面操作间隔，默认15000，最低15000；不是平台风控保证
  --timeout-ms N     页面等待预算，默认15000
  --help             显示帮助

存在 data/china/collection-policy.json 时先筛整页列表，仅 collect 记录读取 JD。
scan 只采集，不运行简历匹配；queue 才写入 career-ops pipeline。
退出码：0=已完成或达到设置上限；2=需登录/验证或部分失败；1=参数/运行错误。
`;
const number=(name,value,defaultValue,min,max)=>{
  if(value===undefined) return defaultValue;
  if(!/^\d+$/.test(value)||Number(value)<min||Number(value)>max) throw new Error(`${name} must be ${min}–${max}`);
  return Number(value);
};

export async function main(args=process.argv.slice(2)) {
  const {values:v,positionals}=parseArgs({args,allowPositionals:true,options:{
    help:{type:'boolean'},platform:{type:'string'},query:{type:'string'},'search-url':{type:'string'},
    root:{type:'string'},limit:{type:'string'},pages:{type:'string'},resume:{type:'boolean'},refresh:{type:'boolean'},
    channel:{type:'string'},headless:{type:'boolean'},'delay-ms':{type:'string'},'timeout-ms':{type:'string'},
    'browser-driver':{type:'string'},
    file:{type:'string'},'code-root':{type:'string'},
    'market-plan':{type:'string'},'market-pool':{type:'string'},'configuration-hash':{type:'string'},
  }});
  if(v.help) { console.log(HELP);return 0; }
  const [command]=positionals;
  if(positionals.length!==1||!['login','scan','list','queue','import','setup-providers'].includes(command)) throw new Error('Choose login, scan, list, queue, import or setup-providers; use --help');
  if(v.platform && !['boss','liepin','linkedin'].includes(v.platform)) throw new Error('platform must be boss, liepin or linkedin');
  if(['login','scan','import'].includes(command)&&!v.platform) throw new Error('--platform is required');
  if(v.query && v['search-url']) throw new Error('--query and --search-url are mutually exclusive');
  const limit=number('limit',v.limit,command==='scan'?5:20,1,command==='scan'?50:500);
  const maxPages=number('pages',v.pages,1,1,20);
  const delayMs=number('delay-ms',v['delay-ms'],15000,15000,60000);
  const timeoutMs=number('timeout-ms',v['timeout-ms'],15000,1000,60000);
  const channel=v.channel||'chrome';
  if(!['chrome','chromium','msedge'].includes(channel)) throw new Error('channel must be chrome, chromium or msedge');
  const browserDriver=selectBrowserDriver({platform:v.platform,channel,headless:!!v.headless,requested:v['browser-driver']});
  if(v['browser-driver']&&command!=='scan')throw new Error('--browser-driver is only valid for scan');
  if(v['code-root']&&command!=='setup-providers')throw new Error('--code-root is only valid for setup-providers');
  const root=v.root?resolve(v.root):getCareerOpsRoot();
  if(v['market-plan']&&command!=='scan')throw new Error('--market-plan is only valid for scan');
  if((v['market-pool']||v['configuration-hash'])&&command!=='queue')throw new Error('--market-pool is only valid for queue');
  const market=loadMarketSelection(root,v['market-pool'],v['configuration-hash']);
  const marketPlan=v['market-plan']?JSON.parse(readFileSync(resolve(root,v['market-plan']),'utf8')):null;
  const platform=v.platform;
  if(command==='setup-providers') {
    const codeRoot=v['code-root']?resolve(v['code-root']):fileURLToPath(new URL('.',import.meta.url));
    console.log(JSON.stringify(setupProviders({codeRoot})));
    return 0;
  }
  if(command==='import') {
    if(!v.file) throw new Error('--file is required');
    if(statSync(v.file).size>10*1024*1024) throw new Error('Import file exceeds 10 MiB');
    console.log(JSON.stringify(await importJobs(root,{platform,records:JSON.parse(readFileSync(v.file,'utf8'))}),null,2));
    return 0;
  }
  if(command==='list') {
    const s=openStore(root);
    console.log(JSON.stringify({jobs:Object.values(s.jobs).filter(j=>!platform||j.platform===platform).map(j=>({key:j.key,url:j.url,...(j.latest||j.latestListing),status:j.lastAttempt.status,firstSeenAt:j.firstSeenAt,lastSeenAt:j.lastSeenAt})),runs:s.runs.filter(r=>!platform||r.platform===platform).map(r=>({id:r.id,status:r.status,reason:r.reason,completed:r.completed,pending:r.pending.length,page:r.pageIndex+1,updatedAt:r.updatedAt}))},null,2));
    return 0;
  }
  if(command==='queue') { console.log(JSON.stringify(await queueJobs(root,{platform,limit,market}),null,2));return 0; }
  const target=v['search-url']?validateSearchUrl(platform,v['search-url']):command==='login'?loginUrl(platform,v.query||'Agent'):searchUrl(platform,v.query);
  const {openBrowser,createBrowserDriver}=await import('./china/browser.mjs');
  if(command==='login') {
    if(v.headless) throw new Error('login requires a visible browser');
    if(!process.stdin.isTTY) throw new Error('Run login from an interactive terminal');
    if(platform==='boss'||browserDriver==='native') {
      const session=await openNativeLogin({root,platform,channel,url:target});
      console.error(`${platform} 专用 Chrome 进程已启动（无调试连接）。请在该窗口完成登录，再回终端按 Enter 保存并关闭。`);
      if(process.platform==='darwin'&&channel==='chrome')console.error('首次原生扫描还需本人启用顶部“显示 → 开发者 → 允许 Apple 事件中的 JavaScript”。无需安装扩展。');
      console.error('程序未读取页面或确认登录；若页面异常请按 Ctrl+C 停止。20分钟未确认会关闭本次窗口。');
      const result=await waitForNativeLogin({session});
      const outcome=loginOutcome(platform,result.status);
      console.log(JSON.stringify(outcome.result));
      return outcome.exitCode;
    }
    const context=await openBrowser({root,platform,channel});
    let rl,session;
    try {
      const page=context.pages()[0] || await context.newPage();
      console.error(`正在打开 ${platform} 登录页并检查页面状态……`);
      session=await prepareLoginPage({page,platform,url:target,timeoutMs});
      if(session.status!=='ready') {
        console.log(JSON.stringify({platform,status:'blocked',reason:session.status,note:'登录页未就绪，已停止；没有确认登录成功。'}));
        return 2;
      }
      rl=createInterface({input:process.stdin,output:process.stderr});
      console.error('登录页内容已就绪。请完成登录后回终端按 Enter；页面变为空白或连续跳转会停止。');
      const ended=await Promise.race([
        new Promise(done=>rl.question('',()=>done('confirm'))),
        session.closed,
      ]);
      const result=ended==='confirm'?await session.complete():ended;
      const outcome=loginOutcome(platform,result.status);
      console.log(JSON.stringify(outcome.result));
      return outcome.exitCode;
    }finally {session?.dispose();rl?.close();await context.close().catch(()=>{});}
  }
  const createDriver=browserDriver==='native'?(await import('./china/native-driver.mjs')).createNativeDriver:createBrowserDriver;
  // Collector validation (including resume policy identity) precedes browser startup.
  let driver;
  const deferredDriver={
    listing:async(...args)=>{
      driver??=await createDriver({root,platform,channel,headless:!!v.headless,delayMs,timeoutMs,onEvent:event=>console.error(JSON.stringify(event))});
      return driver.listing(...args);
    },
    detail:(...args)=>driver.detail(...args),
    next:(...args)=>driver.next(...args),
    requestLog:()=>driver?.requestLog?.()||[],
  };
  try {
    const result=await collect({root,platform,searchUrl:target,limit,maxPages,resume:!!v.resume,skipArchived:!v.refresh,marketPlan,driver:deferredDriver,onProgress:p=>console.error(`${p.key}: ${p.status}`)});
    console.log(JSON.stringify(result,null,2));
    return ['blocked','partial'].includes(result.status)?2:0;
  }finally {await driver?.close();}
}

if(isMainModule(import.meta.url)) {
  main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
}
