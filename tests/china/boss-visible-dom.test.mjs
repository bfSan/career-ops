import test from 'node:test';
import assert from 'node:assert/strict';
import {createBossVisibleDom} from '../../china/boss-visible-runtime.mjs';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
function harness() {
  const clicked=[];
  const el=(label,cls,inJob=false)=>({tagName:'DIV',innerText:label,className:cls,isConnected:true,getClientRects:()=>[{}],contains:()=>false,closest:()=>inJob?{}:null,getAttribute:()=>'',click(){clicked.push(label);}});
  const city=el('南京','city-label'),detail=el('南京','job-location',true),option=el('上海','city-option');
  let opened=false,duplicate=false;
  const document={body:{innerText:'南京 AI Agent 岗位'},querySelectorAll(selector){
    if(selector.startsWith('input')||selector.includes('a.job-name')||selector.includes('more-job'))return [];
    return [city,detail,...(opened?[option]:[]),...(duplicate?[el('杭州','city-label')]:[])];
  }};
  const batch={id:'test',city:'上海',keyword:'AI Agent',records:[],jobs:[]};
  const dom=createBossVisibleDom({document,window:{getComputedStyle:()=>({display:'block',visibility:'visible'})},location:{href:'https://www.zhipin.com/web/geek/jobs?query=AI%20Agent&city=101190100'},extractPage:()=>({status:'ok',jobs:[]}),policy:createBossBatchPolicy()});
  return {dom,batch,clicked,open(){opened=true;},duplicate(){duplicate=true;}};
}
test('BOSS DOM城市筛选排除岗位面板同名地点，菜单打开后仍绑定原筛选',()=>{
  const h=harness();assert.equal(h.dom.snapshot(h.batch).selectedCity,'南京');h.dom.prepare('city-open',h.batch).perform();assert.deepEqual(h.clicked,['南京']);h.open();assert.equal(h.dom.snapshot(h.batch).exactCityOption,true);h.dom.prepare('city-select',h.batch).perform();assert.deepEqual(h.clicked,['南京','上海']);
});
test('BOSS DOM多个独立城市筛选候选时拒绝猜测',()=>{
  const h=harness();h.duplicate();assert.equal(h.dom.snapshot(h.batch).cityControl,false);assert.throws(()=>h.dom.prepare('city-open',h.batch),/控件缺失/);assert.deepEqual(h.clicked,[]);
});
