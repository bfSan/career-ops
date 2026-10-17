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
  version:'0.4.1',
  description:'Automatically opens a bounded visible Liepin search and captures two jobs; no debugger, cookies or private APIs.',
  permissions:['activeTab','scripting','storage','tabs'],
  host_permissions:['https://www.liepin.com/*','https://liepin.com/*','https://c.liepin.com/*'],
  content_scripts:[{matches:['https://www.liepin.com/*','https://liepin.com/*','https://c.liepin.com/*'],js:['content.js'],run_at:'document_idle'}],
  action:{default_title:'CareerOps 猎聘可见采集',default_popup:'popup.html'},
  background:{service_worker:'background.js'},
};
const content=String.raw`(()=>{
'use strict';
if(window.__careerOpsLiepinVisibleCapture)return;
window.__careerOpsLiepinVisibleCapture=true;
const extractPage=${parser};
const KEY='careerOpsLiepinVisibleRecords',LAST='careerOpsLiepinVisibleLastCapture',AUTO_STATE='careerOpsLiepinAutoStateV4',SEARCH_STATE='careerOpsLiepinSearchStateV1',SEARCH_TERM='AI Agent';
const state={records:[],busy:false,autoState:null,searchState:null};
const host=document.createElement('div');host.id='career-ops-liepin-visible-host';
const shadow=host.attachShadow({mode:'closed'});
const style=document.createElement('style');
style.textContent=':host{all:initial}.box{position:fixed;right:18px;top:86px;z-index:2147483647;width:350px;background:#fff;color:#172033;border:1px solid #ff7a00;border-radius:12px;box-shadow:0 8px 30px #0003;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}h3{margin:0 0 8px;font-size:15px}.hint{margin:6px 0;color:#4b5563}.status{white-space:pre-wrap;background:#fff7ed;border-radius:8px;padding:8px;margin:8px 0;max-height:180px;overflow:auto}.row{display:flex;gap:6px;flex-wrap:wrap}button{border:0;border-radius:7px;padding:7px 9px;background:#ff6a00;color:#fff;cursor:pointer}button.secondary{background:#fff0e6;color:#8a3500}button.warn{background:#c2410c}button:disabled{opacity:.5;cursor:wait}.close{float:right;background:transparent;color:#667;padding:0;font-size:18px}';
shadow.append(style);
const box=document.createElement('div');box.className='box';
box.innerHTML='<button class="close" title="关闭">×</button><h3>CareerOps 猎聘可见采集</h3><p class="hint">进入猎聘搜索结果页后自动读取当前页前 2 条岗位；两条至少间隔 15 秒，遇验证立即停止。</p><div class="status">正在恢复本地记录……</div><div class="row"><button class="auto" style="display:none">自动采集前 2 条</button><button class="capture secondary">读取当前岗位</button><button class="download secondary" disabled>导出 JSON</button></div>';
shadow.append(box);document.documentElement.append(host);
const status=box.querySelector('.status'),auto=box.querySelector('.auto'),capture=box.querySelector('.capture'),download=box.querySelector('.download');
const show=value=>{status.textContent=value;};
const close=()=>{if(state.busy)return;host.remove();delete window.__careerOpsLiepinVisibleCapture;};
box.querySelector('.close').addEventListener('click',close);
const storageGet=keys=>new Promise(resolve=>chrome.storage.local.get(keys,resolve));
const storageSet=value=>new Promise(resolve=>chrome.storage.local.set(value,resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const visible=el=>!!el&&!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
function searchInput(){return ['input[placeholder*="职位"]','input[placeholder*="搜索"]','input[name="key"]','input[type="text"]'].map(s=>[...document.querySelectorAll(s)].find(visible)).find(Boolean)||null;}
function searchButton(){const direct=['button.btn-search','.btn-search','button[type="submit"]'].map(s=>[...document.querySelectorAll(s)].find(visible)).find(Boolean);if(direct)return direct;return [...document.querySelectorAll('button,a,div')].find(el=>visible(el)&&/^搜索$/.test((el.innerText||'').trim()))||null;}
function hasSearchQuery(){try{return !!new URL(location.href).searchParams.get('key');}catch{return false;}}
async function fillAndSearch(){
 if(!listingPath.test(location.pathname))throw new Error('当前不是猎聘搜索页');
 const input=searchInput();if(!input)throw new Error('未找到可见猎聘搜索输入框');
 input.focus();input.select();
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(input,SEARCH_TERM);else input.value=SEARCH_TERM;
 input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:SEARCH_TERM}));input.dispatchEvent(new Event('change',{bubbles:true}));
 const button=searchButton();if(!button)throw new Error('未找到可见猎聘搜索按钮');
 button.click();await storageSet({[SEARCH_STATE]:{phase:'clicked',term:SEARCH_TERM,startedAt:Date.now()}});
}
const isLiepin=()=>['www.liepin.com','liepin.com','c.liepin.com'].includes(location.hostname);
const jobPath=/^\/(?:job|a)\/\d+\.shtml$/;
const listingPath=/^\/zhaopin\/?$/;
const canonicalUrl=()=>{const u=new URL(location.href);u.hostname='www.liepin.com';u.search='';u.hash='';return u.href;};
function recordFrom(result){
 const job=result.job||{};
 return {platform:'liepin',url:canonicalUrl(),title:job.title||'',company:job.company||'',location:job.location||'',salaryRaw:job.salaryRaw||'',experience:job.experience||'',education:job.education||'',companySizeRaw:job.companySizeRaw||'',tags:Array.isArray(job.tags)?job.tags:[],advertised:job.advertised===true,listingText:job.listingText||'',description:job.description,complete:true,captureMethod:'browser_extension',observedAt:new Date().toISOString(),sourceText:job.listingText||''};
}
function saveRecord(record){const i=state.records.findIndex(r=>r.url===record.url);if(i<0)state.records.push(record);else state.records[i]=record;download.disabled=!state.records.length;}
async function restore(){const saved=await storageGet([KEY,AUTO_STATE,SEARCH_STATE]);state.records=Array.isArray(saved[KEY])?saved[KEY]:[];state.autoState=saved[AUTO_STATE]||null;state.searchState=saved[SEARCH_STATE]||null;download.disabled=!state.records.length;if(state.autoState?.phase==='running')show('自动采集恢复中：第 '+(state.autoState.index+1)+'/'+state.autoState.jobs.length+' 条\\n累计：'+state.records.length+' 条。');else if(state.autoState?.phase==='stopped')show('自动采集已停止：'+(state.autoState.message||'页面异常')+'\\n累计：'+state.records.length+' 条。');else if(state.autoState?.phase==='done')show('自动采集已完成\\n累计：'+state.records.length+' 条。');else show('已启动。将在可见搜索框填写“'+SEARCH_TERM+'”并点击搜索。\\n累计：'+state.records.length+' 条。');}
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
async function persistAuto(){await storageSet({[AUTO_STATE]:state.autoState});}
async function stopAuto(message){state.autoState={...(state.autoState||{}),phase:'stopped',message};await persistAuto();show('自动采集停止：'+message+'\\n已保留：'+state.records.length+' 条');}
async function finishAuto(){state.autoState={...(state.autoState||{}),phase:'done'};await persistAuto();await downloadRecords();show('自动采集完成：'+state.records.length+' 条，已自动导出 JSON。');}
async function startAuto(){
 if(state.busy||state.autoState?.phase==='running'||!isLiepin()||!listingPath.test(location.pathname))return;
 state.busy=true;auto.disabled=true;capture.disabled=true;box.querySelector('.close').disabled=true;
 try{
  const listing=extractPage({platform:'liepin',kind:'listing'});
  if(listing.status==='challenge')throw new Error('检测到验证页');
  if(listing.status==='login_required')throw new Error('检测到登录门槛');
  if(listing.status!=='ok'||!listing.jobs?.length)throw new Error('当前页没有可读取的岗位卡片');
  const jobs=listing.jobs.map(expectedFromCard).filter(Boolean).slice(0,2);
  if(!jobs.length)throw new Error('当前页没有合法岗位卡片');
  state.autoState={phase:'running',jobs,index:0,listingKey:location.pathname+location.search,listingHref:location.href,nextAt:0};
  await persistAuto();
 }catch(error){await stopAuto(error.message);}finally{state.busy=false;auto.disabled=false;capture.disabled=false;box.querySelector('.close').disabled=false;}
 if(state.autoState?.phase==='running')await continueAuto();
}
async function continueAuto(){
 if(state.busy||state.autoState?.phase!=='running')return;
 state.busy=true;auto.disabled=true;capture.disabled=true;box.querySelector('.close').disabled=true;
 try{
  const run=state.autoState;
  if(!isLiepin())throw new Error('离开猎聘页面');
  if(location.hostname==='safe.liepin.com'||/security|captcha/i.test(location.pathname))throw new Error('检测到验证页');
  if(run.index>=run.jobs.length){await finishAuto();return;}
  if(listingPath.test(location.pathname)){
   if(run.listingKey!==location.pathname+location.search)throw new Error('搜索条件或列表页面已变化');
   const remaining=Math.max(0,(run.nextAt||0)-Date.now());
   if(remaining){show('等待 '+Math.ceil(remaining/1000)+' 秒后读取第 '+(run.index+1)+' 条……');await sleep(remaining);}
   await clickCard(run.jobs[run.index]);
   return;
  }
  if(!jobPath.test(location.pathname))throw new Error('页面已变化');
  const result=await waitDetail(run.jobs[run.index]);
  const record=recordFrom(result);saveRecord(record);
  run.index+=1;run.nextAt=run.index<run.jobs.length?Date.now()+15000+Math.floor(Math.random()*6001):0;
  await storageSet({[KEY]:state.records,[LAST]:Date.now(),[AUTO_STATE]:run});
  show('已读取第 '+run.index+' 条：'+record.title+'\\n正文：'+record.description.length+' 字\\n累计：'+state.records.length+' 条');
  if(run.index<run.jobs.length){location.assign(run.listingHref);return;}
  await finishAuto();
 }catch(error){await stopAuto(error.message);}finally{state.busy=false;auto.disabled=false;capture.disabled=false;box.querySelector('.close').disabled=false;}
}
async function captureManual(){
 if(state.busy)return;state.busy=true;capture.disabled=true;auto.disabled=true;
 try{if(!isLiepin()||!jobPath.test(location.pathname))throw new Error('请先手动打开岗位详情页');const saved=await storageGet([LAST]),last=Number(saved[LAST]||0);if(last&&Date.now()-last<15000)throw new Error('两次读取至少间隔15秒');const result=await readCurrent();const record=recordFrom(result);saveRecord(record);await storageSet({[KEY]:state.records,[LAST]:Date.now()});show('已读取：'+record.title+'\\n正文：'+record.description.length+' 字\\n累计：'+state.records.length+' 条');}catch(error){show('停止：'+error.message+'\\n已保留：'+state.records.length+' 条');}finally{state.busy=false;capture.disabled=false;auto.disabled=false;}
}
async function downloadRecords(){if(!state.records.length)return;const blob=new Blob([JSON.stringify(state.records,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='liepin-visible-jds-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function ensureSearch(){
  if(!isLiepin()||!listingPath.test(location.pathname)||hasSearchQuery())return true;
  if(state.searchState?.phase==='clicked')return false;
  try{await fillAndSearch();show('已在可见搜索框填写“'+SEARCH_TERM+'”，并点击搜索；等待结果页……');}catch(error){state.searchState={phase:'stopped',message:error.message};await storageSet({[SEARCH_STATE]:state.searchState});show('搜索停止：'+error.message);}
  return false;
}
async function maybeAuto(){
  if(state.busy||!isLiepin()||!listingPath.test(location.pathname)||!hasSearchQuery())return;
  const listingKey=location.pathname+location.search;
  if(state.autoState?.phase==='running')return;
  if(state.autoState?.listingKey===listingKey)return;
  if(state.autoState){state.autoState=null;await persistAuto();}
  try{const listing=extractPage({platform:'liepin',kind:'listing'});if(listing.status==='ok'&&Array.isArray(listing.jobs)&&listing.jobs.length)await startAuto();}catch(error){await stopAuto(error.message);}
}
async function watch(){await restore();if(state.autoState?.phase==='running')await continueAuto();else {await ensureSearch();await maybeAuto();}setInterval(()=>{if(state.autoState?.phase==='running')void continueAuto();else void ensureSearch().then(()=>maybeAuto());},1000);}
auto.addEventListener('click',startAuto);capture.addEventListener('click',captureManual);download.addEventListener('click',downloadRecords);watch();
})();`;
const popup=`<!doctype html><meta charset="utf-8"><style>body{width:290px;margin:0;padding:14px;font:14px/1.45 system-ui;color:#172033}h3{margin:0 0 8px}p{color:#4b5563}button{width:100%;border:0;border-radius:8px;padding:9px;background:#ff6a00;color:#fff;cursor:pointer}#status{margin-top:8px;white-space:pre-wrap}</style><h3>CareerOps 猎聘</h3><p>普通 Chrome 可见页面辅助读取；不连接调试器。</p><button id="start">重新注入当前页面板</button><div id="status"></div><script src="popup.js"></script>`;
const popupJs=`document.querySelector('#start').addEventListener('click',async()=>{const s=document.querySelector('#status');try{const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];if(!tab?.id)throw new Error('没有活动标签页');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});s.textContent='已重新注入页面采集面板。';}catch(e){s.textContent='启动失败：'+e.message;}});`;
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const background=`const HOME='https://www.liepin.com/zhaopin/';
async function openSearch(){
   const tabs=await chrome.tabs.query({});
   const existing=tabs.find(t=>{try{return new URL(t.url||'').hostname.endsWith('liepin.com');}catch{return false;}});
   if(existing?.id){await chrome.tabs.update(existing.id,{url:HOME,active:true});return;}
   await chrome.tabs.create({url:HOME,active:true});
 }
 chrome.runtime.onInstalled.addListener(async()=>{await chrome.storage.local.remove(['careerOpsLiepinAutoStateV4','careerOpsLiepinSearchStateV1']);await openSearch();});
 chrome.runtime.onStartup.addListener(openSearch);`;
writeFileSync(join(out,'popup.html'),popup);
writeFileSync(join(out,'popup.js'),popupJs);
writeFileSync(join(out,'content.js'),content);
writeFileSync(join(out,'background.js'),background);
console.log(JSON.stringify({output:out,files:['manifest.json','popup.html','popup.js','content.js','background.js'],permissions:manifest.permissions,hostPermissions:manifest.host_permissions},null,2));
