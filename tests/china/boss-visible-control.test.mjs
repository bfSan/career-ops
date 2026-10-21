import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
import {createBossVisibleWorker} from '../../china/boss-visible-worker.mjs';
import {bossEnvelope} from './boss-batch-fixture.mjs';

test('generated control auto-exports two consecutive batches and closes each owner exactly once',async()=>{
 const root=mkdtempSync(join(tmpdir(),'boss-control-test-'));
 try {
  const build=spawnSync(process.execPath,['china/build-extension.mjs'],{cwd:new URL('../..',import.meta.url),env:{...process.env,CAREER_OPS_ROOT:root},encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const source=readFileSync(join(root,'data/china/extension/boss-visible/control.js'),'utf8');
  const control={url:'chrome-extension://control-test/control.html',frameId:0};
  const data={},tabs=new Map(),events=[],elements={},intervals=[];
  const chrome={runtime:{getURL:p=>'chrome-extension://control-test/'+p},storage:{local:{async get(keys){return structuredClone(Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,data[k]])));},async set(p){Object.assign(data,structuredClone(p));}}},tabs:{async get(id){return tabs.get(id);},async remove(id){tabs.delete(id);events.push('close:'+id);}}};
  const worker=createBossVisibleWorker({chrome,policy:createBossBatchPolicy(),now:()=>Date.parse('2026-10-20T01:00:00Z')});
  function complete(id,owner){
   const receipt=bossEnvelope(),b=receipt.batch;
   for(const r of receipt.records)r.searchContext.batchId=id;
   data[worker.keys.batch]={id,ownerTabId:owner,extensionVersion:'2.0.1',city:b.city,keyword:b.keyword,status:'done',stage:'done',revision:1,startedAt:b.startedAt,endedAt:b.endedAt,evidence:b.listingEvidence,jobs:b.selectedJobs,records:receipt.records,actions:b.actions};
   tabs.set(owner,{id:owner,url:b.listingEvidence.href});
  }
  complete('batch-one',7);tabs.set(99,{id:99,url:control.url});
  vm.runInNewContext(source,{
   chrome:{runtime:{sendMessage:m=>worker.dispatch(m,control)}},
   document:{querySelector:s=>elements[s]||=( {value:'',disabled:false,textContent:''}),createElement:()=>({click(){events.push('download:'+this.download);}})},
   Blob:class{},URL:{createObjectURL:()=> 'blob:offline'},setInterval:fn=>intervals.push(fn),
  });
  await new Promise(setImmediate);
  assert.deepEqual(events,['download:boss-visible-batch-batch-one.json','close:7']);
  complete('batch-two',8);
  for(const refresh of intervals)await refresh();
  assert.deepEqual(events,['download:boss-visible-batch-batch-one.json','close:7','download:boss-visible-batch-batch-two.json','close:8']);
  for(const refresh of intervals)await refresh();assert.equal(events.length,4,'refresh never duplicates a completed export');
  assert.equal(tabs.has(99),true,'local control tab preserved');
 } finally {assert.ok(resolve(root).startsWith(resolve(tmpdir())+'/boss-control-test-'));rmSync(root,{recursive:true,force:true});}
});
