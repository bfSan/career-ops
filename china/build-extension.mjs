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
  version:'0.3.2',
  description:'Automatically opens a bounded visible BOSS search and captures two jobs; no debugger, cookies or private APIs.',
  permissions:['activeTab','scripting','storage','tabs'],
  host_permissions:['https://www.zhipin.com/*','https://zhipin.com/*'],
  content_scripts:[{matches:['https://www.zhipin.com/*','https://zhipin.com/*'],js:['content.js'],run_at:'document_idle'}],
  action:{default_title:'CareerOps BOSS 可见采集',default_popup:'popup.html'},
  background:{service_worker:'background.js'},
};
const content=String.raw`(()=>{
'use strict';
if(window.__careerOpsBossVisibleCapture)return;
window.__careerOpsBossVisibleCapture=true;
const extractPage=${parser};
const KEY='careerOpsBossVisibleRecords',AUTO_STATE='careerOpsBossAutoStateV1',SEARCH_STATE='careerOpsBossSearchStateV1',SEARCH_TERM='AI Agent';
const state={records:[],busy:false,autoState:null,searchState:null};
const host=document.createElement('div');host.id='career-ops-boss-visible-host';
const shadow=host.attachShadow({mode:'closed'});
const style=document.createElement('style');
style.textContent=':host{all:initial}.box{position:fixed;right:18px;top:86px;z-index:2147483647;width:330px;background:#fff;color:#172033;border:1px solid #20b8b8;border-radius:12px;box-shadow:0 8px 30px #0003;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}h3{margin:0 0 8px;font-size:15px}p{margin:6px 0;color:#4b5563}.status{white-space:pre-wrap;background:#f3f7f7;border-radius:8px;padding:8px;margin:8px 0;max-height:170px;overflow:auto}.row{display:flex;gap:6px;flex-wrap:wrap}button{border:0;border-radius:7px;padding:7px 9px;background:#0aa6a6;color:#fff;cursor:pointer}button.secondary{background:#e7eeee;color:#174b4b}button.warn{background:#d97706}button:disabled{opacity:.5;cursor:wait}.close{float:right;background:transparent;color:#667;padding:0;font-size:18px}';
shadow.append(style);
const box=document.createElement('div');box.className='box';
box.innerHTML='<button class="close" title="关闭">×</button><h3>CareerOps BOSS 可见采集</h3><p>进入 BOSS 搜索结果页后自动读取当前页前 2 条岗位，间隔至少 15 秒；遇验证立即停止。</p><div class="status">等待操作。</div><div class="row"><button class="auto">自动采集前 2 条</button><button class="capture secondary">读取当前岗位</button><button class="download secondary" disabled>导出 JSON</button></div>';
shadow.append(box);document.documentElement.append(host);
const status=box.querySelector('.status'),auto=box.querySelector('.auto'),capture=box.querySelector('.capture'),download=box.querySelector('.download');
const show=value=>{status.textContent=value;};
const close=()=>{if(state.busy)return;host.remove();delete window.__careerOpsBossVisibleCapture;};
box.querySelector('.close').addEventListener('click',close);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const storageGet=keys=>new Promise(resolve=>chrome.storage.local.get(keys,resolve));
const storageSet=value=>new Promise(resolve=>chrome.storage.local.set(value,resolve));
const onSearchPage=()=>/^\/web\/geek\/jobs\/?$/.test(location.pathname);
const visible=el=>!!el&&!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
function searchInput(){return ['input.ipt-search','input[name="query"]','input[placeholder*="职位"]','input[placeholder*="搜索"]','input[type="text"]'].map(s=>[...document.querySelectorAll(s)].find(visible)).find(Boolean)||null;}
function searchButton(){const direct=['button.btn-search','.btn-search','button[type="submit"]'].map(s=>[...document.querySelectorAll(s)].find(visible)).find(Boolean);if(direct)return direct;return [...document.querySelectorAll('button,a,div')].find(el=>visible(el)&&/^搜索$/.test((el.innerText||'').trim()))||null;}
async function fillAndSearch(){
 if(!onSearchPage())throw new Error('当前不是 BOSS 搜索页');
 const input=searchInput();if(!input)throw new Error('未找到可见 BOSS 搜索输入框');
 input.focus();input.select();
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(input,SEARCH_TERM);else input.value=SEARCH_TERM;
 input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:SEARCH_TERM}));input.dispatchEvent(new Event('change',{bubbles:true}));
 const button=searchButton();if(!button)throw new Error('未找到可见 BOSS 搜索按钮');
 button.click();
 await storageSet({[SEARCH_STATE]:{phase:'clicked',term:SEARCH_TERM,startedAt:Date.now()}});
}
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
async function runAuto(force=false){
  if(state.busy||state.autoState?.phase==='done'||(state.autoState?.phase==='stopped'&&!force))return;
  state.busy=true;state.autoState={phase:'running',listingKey:location.pathname+location.search};await storageSet({[AUTO_STATE]:state.autoState});auto.disabled=true;capture.disabled=true;box.querySelector('.close').disabled=true;
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
    state.autoState={phase:'done',listingKey:location.pathname+location.search};await storageSet({[AUTO_STATE]:state.autoState,[KEY]:state.records});await downloadRecords();show('自动采集完成：'+state.records.length+' 条，已自动导出 JSON。');
  }catch(error){state.autoState={phase:'stopped',listingKey:location.pathname+location.search,message:error.message};await storageSet({[AUTO_STATE]:state.autoState,[KEY]:state.records});show('自动采集停止：'+error.message+'\n已保留：'+state.records.length+' 条');}
  finally{state.busy=false;auto.disabled=false;capture.disabled=false;box.querySelector('.close').disabled=false;}
}
async function restore(){const saved=await storageGet([KEY,AUTO_STATE,SEARCH_STATE]);state.records=Array.isArray(saved[KEY])?saved[KEY]:[];state.autoState=saved[AUTO_STATE]||null;state.searchState=saved[SEARCH_STATE]||null;download.disabled=!state.records.length;}
function hasSearchQuery(){try{return !!new URL(location.href).searchParams.get('query');}catch{return false;}}
async function ensureSearch(){
 if(!onSearchPage()||hasSearchQuery())return true;
 if(state.searchState?.phase==='clicked')return false;
 try{await fillAndSearch();show('已在可见搜索框填写“'+SEARCH_TERM+'”，并点击搜索；等待结果页……');}catch(error){state.searchState={phase:'stopped',message:error.message};await storageSet({[SEARCH_STATE]:state.searchState});show('搜索停止：'+error.message);}
 return false;
}
async function maybeAuto(){if(state.busy||!onSearchPage()||!hasSearchQuery())return;const key=location.pathname+location.search;if(state.autoState&&(state.autoState.phase==='done'||state.autoState.phase==='stopped'||state.autoState.phase==='running')&&state.autoState.listingKey===key)return;await runAuto(false);}
auto.addEventListener('click',()=>runAuto(true));
capture.addEventListener('click',async()=>{if(state.busy)return;state.busy=true;capture.disabled=true;auto.disabled=true;try{const expected=currentExpected();if(!expected)throw new Error('当前没有可读岗位');const record=await captureExpected(expected);saveRecord(record);await storageSet({[KEY]:state.records});show('已读取：'+record.title+'\\n正文：'+record.description.length+' 字\\n累计：'+state.records.length+' 条');}catch(error){show('停止：'+error.message);}finally{state.busy=false;capture.disabled=false;auto.disabled=false;}});
download.addEventListener('click',downloadRecords);
(async()=>{await restore();show('已启动。将通过可见搜索框填写“'+SEARCH_TERM+'”并点击搜索。\\n累计：'+state.records.length+' 条。');await ensureSearch();await maybeAuto();setInterval(()=>{void ensureSearch().then(()=>maybeAuto());},1000);})();
})();`;
const popup=`<!doctype html><meta charset="utf-8"><style>body{width:280px;margin:0;padding:14px;font:14px/1.45 system-ui;color:#172033}h3{margin:0 0 8px}p{color:#4b5563}button{width:100%;border:0;border-radius:8px;padding:9px;background:#0aa6a6;color:#fff;cursor:pointer}#status{margin-top:8px;white-space:pre-wrap}</style><h3>CareerOps BOSS</h3><p>页面会自动显示采集面板；不连接调试器。</p><button id="start">重新注入当前页面板</button><div id="status"></div><script src="popup.js"></script>`;
const popupJs=`document.querySelector('#start').addEventListener('click',async()=>{const s=document.querySelector('#status');try{const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];if(!tab?.id)throw new Error('没有活动标签页');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});s.textContent='已重新注入页面采集面板。';}catch(e){s.textContent='启动失败：'+e.message;}});`;
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(out,'popup.html'),popup);
writeFileSync(join(out,'popup.js'),popupJs);
const background=`const HOME='https://www.zhipin.com/web/geek/jobs';
async function openSearch(){const tabs=await chrome.tabs.query({});const existing=tabs.find(t=>{try{return new URL(t.url||'').hostname.endsWith('zhipin.com');}catch{return false;}});if(existing?.id)await chrome.tabs.update(existing.id,{url:HOME,active:true});else await chrome.tabs.create({url:HOME,active:true});}
chrome.runtime.onInstalled.addListener(async()=>{await chrome.storage.local.remove(['careerOpsBossAutoStateV1','careerOpsBossSearchStateV1']);await openSearch();});
chrome.runtime.onStartup.addListener(openSearch);`;
writeFileSync(join(out,'content.js'),content);
writeFileSync(join(out,'background.js'),background);
console.log(JSON.stringify({output:out,files:['manifest.json','popup.html','popup.js','content.js','background.js'],permissions:manifest.permissions,contentScripts:manifest.content_scripts},null,2));
