import test from 'node:test';
import assert from 'node:assert/strict';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
import {createBossVisibleWorker} from '../../china/boss-visible-worker.mjs';
const policy=createBossBatchPolicy(),CONTROL={url:'chrome-extension://boss-test/control.html',frameId:0},HOME='https://www.zhipin.com/web/geek/jobs';
function mock(){const data={},tabs=new Map(),removed=[],updated=[];return{runtime:{getURL:n=>'chrome-extension://boss-test/'+n,onMessage:{addListener(){}}},storage:{local:{async get(keys){return Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));},async set(v){Object.assign(data,v);}}},tabs:{async create({url}){const t={id:10,url};tabs.set(10,t);return t;},async get(id){return tabs.get(id);},async remove(id){tabs.delete(id);},onRemoved:{addListener:f=>removed.push(f)},onUpdated:{addListener:f=>updated.push(f)}},_data:data,_tabs:tabs,_removed:removed,_updated:updated};}
const sender=(id,url,documentId='d1')=>({tab:{id,url},url,documentId,frameId:0});
function setup(){let time=Date.parse('2026-10-20T00:00:00Z');const chrome=mock(),worker=createBossVisibleWorker({chrome,policy,now:()=>time,random:()=>.1});return{chrome,worker,advance:ms=>time+=ms};}

test('BOSS worker binds one owner, rejects other tab, and gates first action by shared 15s',async()=>{
 const h=setup(),start=await h.worker.dispatch({type:'START',city:'南京',keyword:'AI Agent'},CONTROL);assert.equal(start.ok,true);const id=start.batch.ownerTabId;
 assert.equal((await h.worker.dispatch({type:'HELLO',href:HOME},sender(99,HOME))).owner,false);
 let r=await h.worker.dispatch({type:'HELLO',href:HOME},sender(id,HOME));assert.equal(r.ok,true);
 r=await h.worker.dispatch({type:'OBSERVE',batchId:r.batch.id,revision:r.batch.revision,stage:r.batch.stage,href:HOME,snapshot:{href:HOME,blank:false,gate:'ok',searchInput:true,searchButton:true}},sender(id,HOME));assert.equal(r.batch.stage,'keyword-ready');
 let reserve=await h.worker.dispatch({type:'RESERVE',batchId:r.batch.id,revision:r.batch.revision,stage:r.batch.stage,href:HOME,kind:'keyword-input',snapshot:{searchInput:true}},sender(id,HOME));assert.ok(reserve.waitMs>0);
 h.advance(15000);reserve=await h.worker.dispatch({type:'RESERVE',batchId:r.batch.id,revision:r.batch.revision,stage:r.batch.stage,href:HOME,kind:'keyword-input',snapshot:{searchInput:true}},sender(id,HOME));assert.equal(reserve.ok,true);
});

test('BOSS worker accepts FDE but rejects unknown keywords and stale stage messages',async()=>{
 const h=setup();
 await assert.rejects(h.worker.dispatch({type:'START',city:'上海',keyword:'FDEx'},CONTROL),/不在计划中/);
 await assert.rejects(h.worker.dispatch({type:'START',city:'深圳',keyword:'FDE'},CONTROL),/不在计划中/);
 const started=await h.worker.dispatch({type:'START',city:'上海',keyword:'AI Agent'},CONTROL);assert.equal(started.ok,true);const id=started.batch.ownerTabId;
 const hello=await h.worker.dispatch({type:'HELLO',href:HOME},sender(id,HOME));
 const stale=await h.worker.dispatch({type:'RESERVE',batchId:hello.batch.id,revision:hello.batch.revision-1,stage:hello.batch.stage,href:HOME,kind:'keyword-input',snapshot:{searchInput:true}},sender(id,HOME));assert.equal(stale.stale,true);
});

test('BOSS navigation listener hard-stops foreign owner navigation',async()=>{
 const h=setup(),started=await h.worker.dispatch({type:'START',city:'福州',keyword:'AI Agent'},CONTROL);h.worker.install();
 for(const listener of h.chrome._updated)listener(started.batch.ownerTabId,{url:'https://example.com/'},{url:'https://example.com/'});await h.worker.idle();
 const state=await h.worker.dispatch({type:'CONTROL_STATE'},CONTROL);assert.equal(state.batch.status,'stopped');assert.match(state.batch.stopReason,/导航/);
});
