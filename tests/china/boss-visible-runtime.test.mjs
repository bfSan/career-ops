import test from 'node:test';
import assert from 'node:assert/strict';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
import {createBossVisibleWorker} from '../../china/boss-visible-worker.mjs';
import {createBossVisibleRuntime} from '../../china/boss-visible-runtime.mjs';
const HOME='https://www.zhipin.com/web/geek/jobs',CONTROL={url:'chrome-extension://boss-flow/control.html',frameId:0};
function harness({letter=false,fallback=false}={}){
 let time=Date.parse('2026-10-20T00:00:00Z'),href=HOME,input='',selected='',menu=false,letterOpened=false,panel=0,id=20,owner;const data={},tabs=new Map(),listeners={remove:[],update:[]},site=[];const jobs=[{url:'https://www.zhipin.com/job_detail/a1.html',title:'AI Agent工程师',location:'南京·雨花台区'},{url:'https://www.zhipin.com/job_detail/a2.html',title:'AI平台工程师',location:'南京·建邺区'}];
 const chrome={runtime:{getURL:n=>'chrome-extension://boss-flow/'+n,onMessage:{addListener(){}}},storage:{local:{async get(keys){return Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));},async set(v){Object.assign(data,JSON.parse(JSON.stringify(v)));}}},tabs:{async create({url}){const tab={id:++id,url};tabs.set(tab.id,tab);owner=tab.id;return tab;},async get(i){return tabs.get(i);},async remove(i){tabs.delete(i);for(const f of listeners.remove)f(i);},onRemoved:{addListener:f=>listeners.remove.push(f)},onUpdated:{addListener:f=>listeners.update.push(f)}}};
 const policy=createBossBatchPolicy(),worker=createBossVisibleWorker({chrome,policy,now:()=>time,random:()=>.3});worker.install();
 const sender=()=>({url:href,tab:{id:owner,url:href},documentId:'spa-doc',frameId:0});chrome.runtime.sendMessage=m=>worker.dispatch(m,sender());
 const record=i=>({platform:'boss',url:jobs[i].url,title:jobs[i].title,location:jobs[i].location,company:'测试公司',description:'负责生产级 AI Agent 平台架构、工具调用、工作流编排、部署、测试评估、监控告警和故障恢复，保证完整上线与持续优化。',complete:true,captureMethod:'browser_extension',observedAt:new Date(time).toISOString(),searchContext:{batchId:data[worker.keys.batch].id,city:'南京',keyword:'AI Agent',listingHref:data[worker.keys.batch].evidence?.href,captureMode:i===0?'current_panel':'clicked_panel',panelEvidence:{jobUrl:jobs[i].url,title:jobs[i].title,location:jobs[i].location,at:new Date(time).toISOString()}}});
 const dom={show(){},snapshot(batch){const url=new URL(href),expected=batch.records.length;let rec=null;if(batch.stage==='panel-probe'&&panel===expected)rec=record(expected);if(batch.stage==='panel-await'&&panel===expected)rec=record(expected);return{href,blank:false,gate:'ok',inputValue:input,searchInput:true,searchButton:true,query:url.searchParams.get('query')||'',cityParam:url.searchParams.get('city')||'',selectedCity:selected,cityControl:true,exactCityOption:menu&&(!letter||letterOpened),cityLetterTab:menu&&letter&&!letterOpened,cityDialogVisible:menu,jobs:batch.stage==='listing-ready'?jobs:[],record:rec,card:batch.stage==='job-ready'?jobs[expected]:null};},prepare(kind,batch){const snapshot=this.snapshot(batch);return{snapshot,perform(){site.push({kind,at:time});if(kind==='keyword-input')input='AI Agent';if(kind==='search'){href=HOME+'?query=AI%20Agent';tabs.get(owner).url=href;}if(kind==='city-open')menu=true;if(kind==='city-letter')letterOpened=true;if(kind==='city-select'){selected='南京';href=HOME+'?query=AI%20Agent&city=101190100';tabs.get(owner).url=href;}if(kind==='job-click')panel=batch.records.length;}};}};
 if(fallback){const original=dom.snapshot.bind(dom);dom.snapshot=b=>{const s=original(b);if(s.record){s.record.locationSource='listing_card';s.record.searchContext.panelEvidence.location='';}return s;};}
  const runtime=createBossVisibleRuntime({chrome,dom,href:()=>href,now:()=>time,schedule:()=>0,cancel(){}});
 return{chrome,worker,runtime,dom,jobs,site,tabs,advance:ms=>time+=ms,start:()=>worker.dispatch({type:'START',city:'南京',keyword:'AI Agent'},CONTROL),control:m=>worker.dispatch(m,CONTROL)};
}

test('BOSS完整离线流：当前面板先读，第二条才点击；动作均>=15秒',async()=>{
 const h=harness(),started=await h.start();assert.equal(started.ok,true);
 for(let i=0;i<40;i++){
  const result=await h.runtime.tick();
  if(result?.waitMs)h.advance(result.waitMs);
  else if(result?.action)h.advance(15000);
  const state=await h.control({type:'CONTROL_STATE'});if(state.batch?.status==='done')break;
 }
 const state=(await h.control({type:'CONTROL_STATE'})).batch;assert.equal(state.status,'done');assert.equal(state.records.length,2);
 assert.equal(h.site.filter(x=>x.kind==='job-click').length,1,'首条完整当前面板不点击，第二条才点击');
 assert.deepEqual(state.records.map(r=>r.searchContext.captureMode),['current_panel','clicked_panel']);
 for(let i=1;i<state.actions.length;i++)assert.ok(Date.parse(state.actions[i].at)-Date.parse(state.actions[i-1].at)>=15000);
 assert.ok(Date.parse(state.records[0].observedAt)-Date.parse(state.actions.filter(a=>a.kind==='city-select').at(-1).at)>=15000,'首条当前面板也等待最后网站动作15秒');
 assert.ok(Date.parse(state.records[1].observedAt)-Date.parse(state.records[0].observedAt)>=15000,'两条面板观测间隔至少15秒');
 const exported=await h.control({type:'AUTO_EXPORT'});assert.equal(exported.ok,true);assert.equal(exported.receipt.kind,'boss_visible_batch');
 const acknowledged=await h.control({type:'EXPORT_DISPATCHED',batchId:state.id});assert.equal(acknowledged.batch.ownerCleanup.status,'closed');assert.equal(h.tabs.has(state.ownerTabId),false);
});

for(const gate of ['challenge','identity_conflict'])test(`BOSS runtime遇${gate}立即硬停，不发送网站动作`,async()=>{
 const h=harness();await h.start();h.dom.snapshot=()=>({href:HOME,blank:false,gate});await h.runtime.tick();const state=(await h.control({type:'CONTROL_STATE'})).batch;assert.equal(state.status,'stopped');assert.equal(h.site.length,0);
});

test('BOSS panelEvidence与记录矛盾时硬停且不归档',async()=>{
 const h=harness();await h.start();const original=h.dom.snapshot.bind(h.dom);h.dom.snapshot=batch=>{const snapshot=original(batch);if(batch.stage==='panel-probe'&&snapshot.record)snapshot.record.searchContext.panelEvidence.title='错误标题';return snapshot;};
 for(let i=0;i<30;i++){const result=await h.runtime.tick();if(result?.waitMs)h.advance(result.waitMs);else if(result?.action)h.advance(15000);const state=(await h.control({type:'CONTROL_STATE'})).batch;if(state.status!=='running')break;}
 const state=(await h.control({type:'CONTROL_STATE'})).batch;assert.equal(state.status,'stopped');assert.equal(state.records.length,0);assert.match(state.stopReason,/panelEvidence/);
});

for(const fallback of [false,true]) test(`BOSS字母分组到回执导出完整链路，列表地点来源=${fallback}`,async()=>{
 const h=harness({letter:true,fallback});await h.start();
 for(let i=0;i<60;i++){const r=await h.runtime.tick();if(r?.waitMs)h.advance(r.waitMs);else h.advance(800);if((await h.control({type:'CONTROL_STATE'})).batch.status!=='running')break;}
 const state=(await h.control({type:'CONTROL_STATE'})).batch;
 assert.equal(state.status,'done',state.stopReason);
 assert.equal(state.actions.filter(a=>a.kind==='city-letter').length,1);
 for(let i=1;i<state.actions.length;i++)assert.ok(Date.parse(state.actions[i].at)-Date.parse(state.actions[i-1].at)>=15000);
 const exp=await h.control({type:'EXPORT'});assert.equal(exp.ok,true);createBossBatchPolicy().validateReceipt(exp.receipt);
 if(fallback){assert.equal(exp.receipt.records[0].locationSource,'listing_card');assert.equal(exp.receipt.records[0].searchContext.panelEvidence.location,'');}
 const ack=await h.control({type:'EXPORT_DISPATCHED',batchId:state.id});assert.equal(ack.batch.ownerCleanup.status,'closed');
});
