#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {extractPage} from './platforms.mjs';

const root=getCareerOpsRoot();
const out=join(root,'data','china','extension','liepin-visible');
mkdirSync(out,{recursive:true,mode:0o700});
const parser=extractPage.toString();
const manifest={
  manifest_version:3,
  name:'CareerOps Liepin Visible Capture',
  version:'0.2.0',
  description:'User-started bounded visible Liepin capture; no debugger, cookies, private APIs or background automation.',
  permissions:['activeTab','scripting','storage'],
  host_permissions:['https://www.liepin.com/*','https://liepin.com/*','https://c.liepin.com/*'],
  content_scripts:[{matches:['https://www.liepin.com/*','https://liepin.com/*','https://c.liepin.com/*'],js:['content.js'],run_at:'document_idle'}],
  action:{default_title:'CareerOps 猎聘可见采集',default_popup:'popup.html'},
};
const content=String.raw`(()=>{
'use strict';
if(window.__careerOpsLiepinVisibleCapture)return;
window.__careerOpsLiepinVisibleCapture=true;
const extractPage=${parser};
const KEY='careerOpsLiepinVisibleRecords',LAST='careerOpsLiepinVisibleLastCapture';
const state={records:[],busy:false};
const host=document.createElement('div');host.id='career-ops-liepin-visible-host';
const shadow=host.attachShadow({mode:'closed'});
const style=document.createElement('style');
style.textContent=':host{all:initial}.box{position:fixed;right:18px;top:86px;z-index:2147483647;width:350px;background:#fff;color:#172033;border:1px solid #ff7a00;border-radius:12px;box-shadow:0 8px 30px #0003;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}h3{margin:0 0 8px;font-size:15px}.hint{margin:6px 0;color:#4b5563}.status{white-space:pre-wrap;background:#fff7ed;border-radius:8px;padding:8px;margin:8px 0;max-height:180px;overflow:auto}.row{display:flex;gap:6px;flex-wrap:wrap}button{border:0;border-radius:7px;padding:7px 9px;background:#ff6a00;color:#fff;cursor:pointer}button.secondary{background:#fff0e6;color:#8a3500}button.warn{background:#c2410c}button:disabled{opacity:.5;cursor:wait}.close{float:right;background:transparent;color:#667;padding:0;font-size:18px}';
shadow.append(style);
const box=document.createElement('div');box.className='box';
box.innerHTML='<button class="close" title="关闭">×</button><h3>CareerOps 猎聘可见采集</h3><p class="hint">先手动搜索。自动模式最多读取当前页前 2 条岗位，两条至少间隔 15 秒；遇验证立即停止。</p><div class="status">正在恢复本地记录……</div><div class="row"><button class="auto">自动采集前 2 条</button><button class="capture secondary">读取当前岗位</button><button class="download secondary" disabled>导出 JSON</button></div>';
shadow.append(box);document.documentElement.append(host);
const status=box.querySelector('.status'),auto=box.querySelector('.auto'),capture=box.querySelector('.capture'),download=box.querySelector('.download');
const show=value=>{status.textContent=value;};
const close=()=>{if(state.busy)return;host.remove();delete window.__careerOpsLiepinVisibleCapture;};
box.querySelector('.close').addEventListener('click',close);
const storageGet=keys=>new Promise(resolve=>chrome.storage.local.get(keys,resolve));
const storageSet=value=>new Promise(resolve=>chrome.storage.local.set(value,resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const isLiepin=()=>['www.liepin.com','liepin.com','c.liepin.com'].includes(location.hostname);
const jobPath=/^\/(?:job|a)\/\d+\.shtml$/;
const listingPath=/^\/zhaopin\/?$/;
const canonicalUrl=()=>{const u=new URL(location.href);u.hostname='www.liepin.com';u.search='';u.hash='';return u.href;};
function recordFrom(result){
 const job=result.job||{};
 return {platform:'liepin',url:canonicalUrl(),title:job.title||'',company:job.company||'',location:job.location||'',salaryRaw:job.salaryRaw||'',experience:job.experience||'',education:job.education||'',companySizeRaw:job.companySizeRaw||'',tags:Array.isArray(job.tags)?job.tags:[],advertised:job.advertised===true,listingText:job.listingText||'',description:job.description,complete:true,captureMethod:'browser_extension',observedAt:new Date().toISOString(),sourceText:job.listingText||''};
}
function saveRecord(record){const i=state.records.findIndex(r=>r.url===record.url);if(i<0)state.records.push(record);else state.records[i]=record;download.disabled=!state.records.length;}
async function restore(){const saved=await storageGet([KEY]);state.records=Array.isArray(saved[KEY])?saved[KEY]:[];download.disabled=!state.records.length;show('已启动。请手动搜索并打开岗位，或点击“自动采集前 2 条”。\\n累计：'+state.records.length+' 条。');}
async function readCurrent(){
 const result=extractPage({platform:'liepin',kind:'detail'});
 if(result.status==='challenge')throw new Error('检测到验证页，自动采集停止');
 if(result.status==='login_required')throw new Error('检测到登录门槛，自动采集停止');
 if(result.status!=='ok'||!result.job?.description)throw new Error('当前不是完整 JD，或页面仍在加载');
 if(result.job.description.length<40)throw new Error('正文过短，未确认完整 JD');
 return result;
}
async function waitDetail(expected){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(!isLiepin())throw new Error('离开猎聘页面，自动采集停止');
  if(location.hostname==='safe.liepin.com'||/security|captcha/i.test(location.pathname))throw new Error('检测到验证页，自动采集停止');
  if(jobPath.test(location.pathname)){
   try{const result=await readCurrent();const actual=new URL(location.href).pathname;if(actual===new URL(expected.url).pathname)return result;}catch(error){if(/验证页|登录门槛/.test(error.message))throw error;}
  }
  await sleep(300);
 }
 throw new Error('等待岗位详情超时，自动采集停止');
}
function expectedFromCard(card){
 try{const u=new URL(card.url,location.href);if(!/^\/(?:job|a)\/\d+\.shtml$/.test(u.pathname))return null;return {url:u.href,title:card.title||''};}catch{return null;}
}
function findCard(expected){
 const path=new URL(expected.url,location.href).pathname;
 const anchors=[...document.querySelectorAll('a[href*="/job/"],a[href*="/a/"]')].filter(a=>a.getClientRects().length);
 const matches=anchors.filter(a=>{try{return new URL(a.getAttribute('href'),location.href).pathname===path;}catch{return false;}});
 if(matches.length!==1)throw new Error('岗位卡片身份不唯一，自动采集停止');
 return matches[0];
}
async function clickCard(expected){
 const anchor=findCard(expected);if(anchor.getAttribute('target'))anchor.removeAttribute('target');anchor.click();
}
async function returnListing(){history.back();const deadline=Date.now()+15000;while(Date.now()<deadline){if(listingPath.test(location.pathname)){const r=extractPage({platform:'liepin',kind:'listing'});if(r.status==='ok')return r;}if(location.hostname==='safe.liepin.com'||/security|captcha/i.test(location.pathname))throw new Error('检测到验证页，自动采集停止');await sleep(300);}throw new Error('返回猎聘列表超时，自动采集停止');}
async function runAuto(){
 if(state.busy)return;state.busy=true;auto.disabled=true;capture.disabled=true;box.querySelector('.close').disabled=true;
 try{
  if(!isLiepin()||!listingPath.test(location.pathname))throw new Error('请先手动打开猎聘搜索结果页');
  const listing=extractPage({platform:'liepin',kind:'listing'});
  if(listing.status==='challenge')throw new Error('检测到验证页，自动采集停止');
  if(listing.status==='login_required')throw new Error('检测到登录门槛，自动采集停止');
  if(listing.status!=='ok'||!listing.jobs?.length)throw new Error('当前页没有可读取的岗位卡片');
  const jobs=listing.jobs.map(expectedFromCard).filter(Boolean).slice(0,2);
  if(!jobs.length)throw new Error('当前页没有合法岗位卡片');
  for(let i=0;i<jobs.length;i++){
   if(i>0){const wait=15000+Math.floor(Math.random()*6001);show('等待 '+Math.round(wait/1000)+' 秒后读取第 '+(i+1)+' 条……');await sleep(wait);}
   if(!listingPath.test(location.pathname))throw new Error('页面已变化，自动采集停止');
   await clickCard(jobs[i]);
   const result=await waitDetail(jobs[i]);
   const record=recordFrom(result);saveRecord(record);await storageSet({[KEY]:state.records,[LAST]:Date.now()});
   show('已读取第 '+(i+1)+' 条：'+record.title+'\\n正文：'+record.description.length+' 字\\n累计：'+state.records.length+' 条');
   if(i<jobs.length-1)await returnListing();
  }
  show('自动采集完成：'+state.records.length+' 条。点击“导出 JSON”后运行 china:import。');
 }catch(error){show('自动采集停止：'+error.message+'\\n已保留：'+state.records.length+' 条');}
 finally{state.busy=false;auto.disabled=false;capture.disabled=false;box.querySelector('.close').disabled=false;}
}
async function captureManual(){
 if(state.busy)return;state.busy=true;capture.disabled=true;auto.disabled=true;
 try{if(!isLiepin()||!jobPath.test(location.pathname))throw new Error('请先手动打开岗位详情页');const saved=await storageGet([LAST]),last=Number(saved[LAST]||0);if(last&&Date.now()-last<15000)throw new Error('两次读取至少间隔15秒');const result=await readCurrent();const record=recordFrom(result);saveRecord(record);await storageSet({[KEY]:state.records,[LAST]:Date.now()});show('已读取：'+record.title+'\\n正文：'+record.description.length+' 字\\n累计：'+state.records.length+' 条');}catch(error){show('停止：'+error.message+'\\n已保留：'+state.records.length+' 条');}finally{state.busy=false;capture.disabled=false;auto.disabled=false;}
}
async function downloadRecords(){if(!state.records.length)return;const blob=new Blob([JSON.stringify(state.records,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='liepin-visible-jds-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
auto.addEventListener('click',runAuto);capture.addEventListener('click',captureManual);download.addEventListener('click',downloadRecords);restore();
})();`;
const popup=`<!doctype html><meta charset="utf-8"><style>body{width:290px;margin:0;padding:14px;font:14px/1.45 system-ui;color:#172033}h3{margin:0 0 8px}p{color:#4b5563}button{width:100%;border:0;border-radius:8px;padding:9px;background:#ff6a00;color:#fff;cursor:pointer}#status{margin-top:8px;white-space:pre-wrap}</style><h3>CareerOps 猎聘</h3><p>普通 Chrome 可见页面辅助读取；不连接调试器。</p><button id="start">重新注入当前页面板</button><div id="status"></div><script src="popup.js"></script>`;
const popupJs=`document.querySelector('#start').addEventListener('click',async()=>{const s=document.querySelector('#status');try{const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];if(!tab?.id)throw new Error('没有活动标签页');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});s.textContent='已重新注入页面采集面板。';}catch(e){s.textContent='启动失败：'+e.message;}});`;
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(out,'popup.html'),popup);
writeFileSync(join(out,'popup.js'),popupJs);
writeFileSync(join(out,'content.js'),content);
console.log(JSON.stringify({output:out,files:['manifest.json','popup.html','popup.js','content.js'],permissions:manifest.permissions,hostPermissions:manifest.host_permissions},null,2));
