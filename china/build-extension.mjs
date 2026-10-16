#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {extractPage} from './platforms.mjs';

const root=getCareerOpsRoot();
const out=join(root,'data','china','extension','boss-visible');
mkdirSync(out,{recursive:true,mode:0o700});
const parser=extractPage.toString();
const manifest={
  manifest_version:3,
  name:'CareerOps BOSS Visible Capture',
  version:'0.2.0',
  description:'User-started bounded visible BOSS capture; no debugger, cookies or private APIs.',
  permissions:['activeTab','scripting','storage'],
  host_permissions:['https://www.zhipin.com/*','https://zhipin.com/*'],
  content_scripts:[{matches:['https://www.zhipin.com/*','https://zhipin.com/*'],js:['content.js'],run_at:'document_idle'}],
  action:{default_title:'CareerOps BOSS 可见采集',default_popup:'popup.html'},
};
const content=String.raw`(()=>{
'use strict';
if(window.__careerOpsBossVisibleCapture)return;
window.__careerOpsBossVisibleCapture=true;
const extractPage=${parser};
const state={records:[],busy:false};
const host=document.createElement('div');host.id='career-ops-boss-visible-host';
const shadow=host.attachShadow({mode:'closed'});
const style=document.createElement('style');
style.textContent=':host{all:initial}.box{position:fixed;right:18px;top:86px;z-index:2147483647;width:330px;background:#fff;color:#172033;border:1px solid #20b8b8;border-radius:12px;box-shadow:0 8px 30px #0003;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}h3{margin:0 0 8px;font-size:15px}p{margin:6px 0;color:#4b5563}.status{white-space:pre-wrap;background:#f3f7f7;border-radius:8px;padding:8px;margin:8px 0;max-height:170px;overflow:auto}.row{display:flex;gap:6px;flex-wrap:wrap}button{border:0;border-radius:7px;padding:7px 9px;background:#0aa6a6;color:#fff;cursor:pointer}button.secondary{background:#e7eeee;color:#174b4b}button.warn{background:#d97706}button:disabled{opacity:.5;cursor:wait}.close{float:right;background:transparent;color:#667;padding:0;font-size:18px}';
shadow.append(style);
const box=document.createElement('div');box.className='box';
box.innerHTML='<button class="close" title="关闭">×</button><h3>CareerOps BOSS 可见采集</h3><p>先手动完成搜索。自动模式最多读取当前页前 2 条岗位，间隔至少 15 秒。</p><div class="status">等待操作。</div><div class="row"><button class="auto">自动采集前 2 条</button><button class="capture secondary">读取当前岗位</button><button class="download secondary" disabled>导出 JSON</button></div>';
shadow.append(box);document.documentElement.append(host);
const status=box.querySelector('.status'),auto=box.querySelector('.auto'),capture=box.querySelector('.capture'),download=box.querySelector('.download');
const show=value=>{status.textContent=value;};
const close=()=>{if(state.busy)return;host.remove();delete window.__careerOpsBossVisibleCapture;};
box.querySelector('.close').addEventListener('click',close);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const onSearchPage=()=>/^\/web\/geek\/jobs\/?$/.test(location.pathname);
function expectedFromJob(job){
  const u=new URL(job.url,location.href),id=u.pathname.match(/^\/job_detail\/([A-Za-z0-9_-]+)\.html$/)?.[1];
  if(!id)return null;
  return {id,title:job.title||'',url:new URL('/job_detail/'+id+'.html',location.origin).href};
}
function currentExpected(){
  const active=[...document.querySelectorAll('.job-card-wrap.active')].filter(e=>e.getClientRects().length);
  if(active.length!==1)return null;
  const anchor=active[0].querySelector('a.job-name[href*="/job_detail/"]');
  if(!anchor)return null;
  const href=anchor.getAttribute('href')||'';
  const id=href.match(/^\/job_detail\/([A-Za-z0-9_-]+)\.html$/)?.[1];
  const title=(anchor.innerText||'').trim();
  if(!id||!title)return null;
  return {id,title,url:new URL('/job_detail/'+id+'.html',location.origin).href};
}
function toRecord(result,expected){
  const job=result.job||{};
  return {platform:'boss',url:expected.url,title:job.title||expected.title,company:job.company||'',location:job.location||'',salaryRaw:job.salaryRaw||'',experience:job.experience||'',education:job.education||'',companySizeRaw:job.companySizeRaw||'',tags:Array.isArray(job.tags)?job.tags:[],advertised:job.advertised===true,listingText:job.listingText||'',description:job.description,complete:true,captureMethod:'browser_extension',observedAt:new Date().toISOString(),sourceText:job.listingText||''};
}
function saveRecord(record){
  const i=state.records.findIndex(r=>r.url===record.url);
  if(i<0)state.records.push(record);else state.records[i]=record;
  download.disabled=!state.records.length;
}
async function readPanel(expected){
  const until=Date.now()+15000;
  while(Date.now()<until){
    if(!onSearchPage())throw new Error('页面已离开搜索结果页，自动采集停止');
    const result=extractPage({platform:'boss',kind:'panel',expected});
    if(result.status==='challenge')throw new Error('检测到验证页，自动采集已停止');
    if(result.status==='login_required')throw new Error('检测到登录门槛，自动采集已停止');
    if(result.status==='ok'&&result.job?.description){
      if(result.job.description.length<40)throw new Error('正文过短，未确认是完整 JD');
      return result;
    }
    await sleep(250);
  }
  throw new Error('等待岗位面板超时，未确认完整 JD');
}
async function selectCard(expected){
  if(!onSearchPage())throw new Error('当前不是 BOSS 搜索结果页');
  const anchors=[...document.querySelectorAll('.job-card-wrap a.job-name[href*="/job_detail/"]')].filter(a=>a.getClientRects().length);
  const matches=anchors.filter(a=>{try{return new URL(a.getAttribute('href'),location.href).pathname===new URL(expected.url).pathname;}catch{return false;}});
  if(matches.length!==1)throw new Error('岗位卡片身份不唯一，自动采集停止');
  const anchor=matches[0];
  anchor.addEventListener('click',event=>event.preventDefault(),{once:true});
  anchor.click();
}
async function captureExpected(expected){
  const current=currentExpected();
  if(!current||current.id!==expected.id){await selectCard(expected);}
  const result=await readPanel(expected);
  const record=toRecord(result,expected);saveRecord(record);return record;
}
async function downloadRecords(){
  if(!state.records.length)return;
  const blob=new Blob([JSON.stringify(state.records,null,2)+'\n'],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='boss-visible-jds-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function runAuto(){
  if(state.busy)return;
  state.busy=true;auto.disabled=true;capture.disabled=true;box.querySelector('.close').disabled=true;
  try{
    if(!onSearchPage())throw new Error('请先打开 BOSS 搜索结果页');
    const listing=extractPage({platform:'boss',kind:'listing'});
    if(listing.status==='challenge')throw new Error('检测到验证页，自动采集停止');
    if(listing.status==='login_required')throw new Error('检测到登录门槛，自动采集停止');
    if(listing.status!=='ok'||!listing.jobs?.length)throw new Error('当前页没有可读取的岗位卡片');
    const jobs=listing.jobs.slice(0,2);
    for(let i=0;i<jobs.length;i++){
      if(i>0){const wait=15000+Math.floor(Math.random()*6001);show('等待 '+Math.round(wait/1000)+' 秒后读取第 '+(i+1)+' 条……');await sleep(wait);}
      const expected=expectedFromJob(jobs[i]);
      if(!expected||!expected.title)throw new Error('岗位身份不完整，自动采集停止');
      const record=await captureExpected(expected);
      show('已读取第 '+(i+1)+' 条：'+record.title+'\n正文：'+record.description.length+' 字\n累计：'+state.records.length+' 条');
    }
    show('自动采集完成：'+state.records.length+' 条。点击“导出 JSON”后运行 china:import。');
  }catch(error){show('自动采集停止：'+error.message+'\n已保留：'+state.records.length+' 条');}
  finally{state.busy=false;auto.disabled=false;capture.disabled=false;box.querySelector('.close').disabled=false;}
}
auto.addEventListener('click',runAuto);
capture.addEventListener('click',async()=>{
  if(state.busy)return;
  state.busy=true;capture.disabled=true;auto.disabled=true;
  try{const expected=currentExpected();if(!expected)throw new Error('请先手动点击一个岗位卡片');const record=await captureExpected(expected);show('已读取：'+record.title+'\n正文：'+record.description.length+' 字\n累计：'+state.records.length+' 条');}
  catch(error){show('停止：'+error.message);}
  finally{state.busy=false;capture.disabled=false;auto.disabled=false;}
});
download.addEventListener('click',downloadRecords);
show('已启动。请先手动搜索，再点击“自动采集前 2 条”。');
})();`;
const popup=`<!doctype html><meta charset="utf-8"><style>body{width:280px;margin:0;padding:14px;font:14px/1.45 system-ui;color:#172033}h3{margin:0 0 8px}p{color:#4b5563}button{width:100%;border:0;border-radius:8px;padding:9px;background:#0aa6a6;color:#fff;cursor:pointer}#status{margin-top:8px;white-space:pre-wrap}</style><h3>CareerOps BOSS</h3><p>页面会自动显示采集面板；不连接调试器。</p><button id="start">重新注入当前页面板</button><div id="status"></div><script src="popup.js"></script>`;
const popupJs=`document.querySelector('#start').addEventListener('click',async()=>{const s=document.querySelector('#status');try{const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];if(!tab?.id)throw new Error('没有活动标签页');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});s.textContent='已重新注入页面采集面板。';}catch(e){s.textContent='启动失败：'+e.message;}});`;
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(out,'popup.html'),popup);
writeFileSync(join(out,'popup.js'),popupJs);
writeFileSync(join(out,'content.js'),content);
console.log(JSON.stringify({output:out,files:['manifest.json','popup.html','popup.js','content.js'],permissions:manifest.permissions,contentScripts:manifest.content_scripts},null,2));
