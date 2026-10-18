#!/usr/bin/env node
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {extractPage} from './platforms.mjs';
import {createLiepinBatchPolicy} from './liepin-batch-policy.mjs';
import {createLiepinVisibleWorker} from './liepin-visible-worker.mjs';
import {createLiepinVisibleDom, createLiepinVisibleRuntime} from './liepin-visible-runtime.mjs';

const root = getCareerOpsRoot();
const out = join(root, 'data', 'china', 'extension', 'liepin-visible');
const policy = createLiepinBatchPolicy();
const defaults = {
  city: policy.cities.includes((process.env.CAREER_OPS_CITY || '').trim()) ? process.env.CAREER_OPS_CITY.trim() : '上海',
  keyword: policy.keywords.includes((process.env.CAREER_OPS_KEYWORD || '').trim()) ? process.env.CAREER_OPS_KEYWORD.trim() : 'AI Agent',
};
const manifest = {
  manifest_version: 3,
  name: 'CareerOps 猎聘可见单标签批次',
  version: '2.0.0',
  description: '用户显式开始的1–2条可见单标签批次；不使用调试器、私有接口或自动联系投递。',
  permissions: ['storage', 'tabs'],
  host_permissions: ['https://www.liepin.com/*', 'https://liepin.com/*', 'https://c.liepin.com/*', 'https://safe.liepin.com/*'],
  content_scripts: [{matches: ['https://www.liepin.com/*', 'https://liepin.com/*', 'https://c.liepin.com/*', 'https://safe.liepin.com/*'], js: ['content.js'], run_at: 'document_idle', all_frames: false}],
  action: {default_title: 'CareerOps 猎聘批次控制', default_popup: 'popup.html'},
  background: {service_worker: 'background.js'},
};
const background = `'use strict';\nconst policy = (${createLiepinBatchPolicy.toString()})();\n(${createLiepinVisibleWorker.toString()})({chrome,policy}).install();\n`;
const content = `'use strict';\nif (!globalThis.__careerOpsLiepinVisibleBatchV2) {\n globalThis.__careerOpsLiepinVisibleBatchV2 = true;\n const policy = (${createLiepinBatchPolicy.toString()})();\n const extractPage = ${extractPage.toString()};\n const dom = (${createLiepinVisibleDom.toString()})({window,document,location,history,extractPage,policy});\n const runtime = (${createLiepinVisibleRuntime.toString()})({chrome,dom,href:()=>location.href});\n runtime.start();\n}\n`;
const style = `body{font:14px/1.5 system-ui;color:#172033}button,select{font:inherit;padding:9px;border-radius:7px;border:1px solid #d1d5db}button{background:#ea580c;color:#fff;border:0;cursor:pointer}button:disabled{opacity:.5;cursor:default}`;
const popup = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${style}body{width:270px;padding:14px;margin:0}h3{margin-top:0}button{width:100%}</style><h3>猎聘可见批次</h3><p>在本地控制页选择城市与关键词，显式开始绑定新标签的1–2条批次。</p><button id="open">打开批次控制页</button><script src="popup.js"></script></html>`;
const popupJs = `document.querySelector('#open').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('control.html'),active:true}));\n`;
const control = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CareerOps 猎聘批次控制</title><style>${style}body{max-width:780px;margin:32px auto;padding:0 18px}h1{font-size:23px}label{display:block;margin:14px 0 5px}button{margin:16px 8px 0 0}.stop{background:#b42318}.export{background:#2563eb}pre{padding:14px;background:#fff7ed;border-radius:9px;white-space:pre-wrap}#notice{color:#9a3412;min-height:22px}</style><h1>猎聘可见单标签批次</h1><p>仅点击开始才打开无参数列表页。网站动作每次至少间隔15秒，每批最多2条，不翻页、不联系、不投递。挑战、登录、空白或身份/地点变化均硬停，刷新不会重新开始。</p><label for="city">目标城市</label><select id="city">${policy.cities.map(c => `<option>${c}</option>`).join('')}</select><label for="keyword">精确关键词</label><select id="keyword">${policy.keywords.map(k => `<option>${k}</option>`).join('')}</select><div><button id="start">开始1–2条批次</button><button class="stop" id="stop">停止</button><button class="export" id="export" disabled>导出本批回执</button></div><p id="notice" role="status"></p><pre id="state">正在读取持久化批次……</pre><script src="control.js"></script></html>`;
const controlJs = `'use strict';
const defaults=${JSON.stringify(defaults)};
const city=document.querySelector('#city'),keyword=document.querySelector('#keyword'),start=document.querySelector('#start'),stop=document.querySelector('#stop'),exportButton=document.querySelector('#export'),state=document.querySelector('#state'),notice=document.querySelector('#notice');
city.value=defaults.city;keyword.value=defaults.keyword;
let starting=false,cancelStart=false,busy=false,autoExporting=false;
const send=message=>chrome.runtime.sendMessage(message);
function render(batch){const running=batch?.status==='running';start.disabled=running||starting;stop.disabled=!running&&!starting;city.disabled=running||starting;keyword.disabled=running||starting;exportButton.disabled=batch?.status!=='done';state.textContent=batch?JSON.stringify({batchId:batch.batchId,ownerTabId:batch.ownerTabId,city:batch.city,keyword:batch.keyword,version:batch.version,status:batch.status,stage:batch.stage,records:batch.records.length,stopReason:batch.stopReason,evidence:batch.evidence,actions:batch.actions},null,2):'当前没有批次；点击开始不会复用其他猎聘标签。';}
function download(receipt){const blob=new Blob([JSON.stringify(receipt,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='liepin-visible-batch-'+receipt.batch.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function autoExport(batch){if(autoExporting||!batch||batch.status!=='done'||batch.exportedBatchId===batch.batchId)return;autoExporting=true;try{const r=await send({type:'AUTO_EXPORT'});if(r?.ok){download(r.receipt);notice.textContent='批次完成，已自动导出仅含本批记录的 schemaVersion 2 回执。';render(r.batch||batch);}}catch(e){notice.textContent='自动导出失败：'+e.message;}finally{autoExporting=false;}}
async function refresh(){if(busy)return;busy=true;try{const r=await send({type:'CONTROL_STATE'});render(r.batch);await autoExport(r.batch);}catch(e){notice.textContent='本地状态读取失败：'+e.message;}finally{busy=false;}}
start.onclick=async()=>{if(starting)return;starting=true;cancelStart=false;const config={city:city.value,keyword:keyword.value};try{while(!cancelStart){const r=await send({type:'START',...config});render(r.batch);if(r.ok){notice.textContent='已新建唯一 owner 标签；仅该标签可发送网站动作。';break;}if(!r.waitMs){notice.textContent=r.message||'未开始';break;}notice.textContent='跨批次动作间隔尚有 '+Math.ceil(r.waitMs/1000)+' 秒；等待期间可停止。';await new Promise(resolve=>setTimeout(resolve,Math.min(800,r.waitMs)));}}catch(e){notice.textContent='开始失败：'+e.message;}finally{starting=false;await refresh();}};
stop.onclick=async()=>{cancelStart=true;const r=await send({type:'CONTROL_STOP',reason:'用户在可见控制页停止'});notice.textContent='已持久化停止；刷新不会自动重启。';render(r.batch);};
exportButton.onclick=async()=>{const r=await send({type:'EXPORT'});if(!r.ok){notice.textContent=r.message;return;}download(r.receipt);notice.textContent='已手动导出本批回执。';};
refresh();setInterval(refresh,800);
`;
mkdirSync(out, {recursive: true, mode: 0o700});
const files = {'manifest.json': JSON.stringify(manifest, null, 2) + '\n', 'background.js': background, 'content.js': content, 'popup.html': popup, 'popup.js': popupJs, 'control.html': control, 'control.js': controlJs};
for (const [name, source] of Object.entries(files)) writeFileSync(join(out, name), source, {mode: 0o600});
console.log(JSON.stringify({output: out, files: Object.keys(files), defaults, permissions: manifest.permissions}, null, 2));
