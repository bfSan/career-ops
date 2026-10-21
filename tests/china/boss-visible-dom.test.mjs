import test from 'node:test';
import assert from 'node:assert/strict';
import {createBossVisibleDom} from '../../china/boss-visible-runtime.mjs';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';
function harness() {
  const clicked=[];
  const el=(label,cls,inJob=false)=>({tagName:'DIV',innerText:label,className:cls,isConnected:true,getClientRects:()=>[{}],contains:()=>false,closest:()=>inJob?{}:null,getAttribute:()=>'',click(){clicked.push(label);}});
  const city=el('南京','city-label'),detail=el('南京','job-location',true),option=el('上海','city-option');
  let opened=false,duplicate=false;
  const heading=el('请选择城市','dialog-title'),groupN=el('KLMN','tab'),groupF=el('FGHJ','tab');
  const dialog={querySelectorAll:()=>[heading,groupN,groupF,option],parentElement:null};
  heading.parentElement=dialog;
  const document={body:{innerText:'南京 AI Agent 岗位'},querySelectorAll(selector){
    if(selector.startsWith('input')||selector.includes('a.job-name')||selector.includes('more-job'))return [];
    return [city,detail,...(opened?[heading,groupN,groupF,option]:[]),...(duplicate?[el('杭州','city-label')]:[])];
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
test('BOSS DOM未选定岗位前不因首页默认推荐面板而identity_conflict',()=>{
  const panel={status:'ok',job:{title:'无关默认推荐',location:'北京',description:'x'.repeat(80)}};
  const dom=createBossVisibleDom({document:{body:{innerText:'搜索职位'},querySelectorAll:()=>[]},window:{getComputedStyle:()=>({display:'block',visibility:'visible'})},location:{href:'https://www.zhipin.com/web/geek/jobs'},extractPage:({kind})=>kind==='panel'?panel:{status:'ok',jobs:[]},policy:createBossBatchPolicy()});
  const snapshot=dom.snapshot({id:'b',city:'杭州',keyword:'AI Agent',records:[],jobs:[],stage:'opening'});
  assert.equal(snapshot.gate,'ok');assert.equal(snapshot.record,null);
  const chosen=dom.snapshot({id:'b',city:'杭州',keyword:'AI Agent',records:[],stage:'panel-probe',jobs:[{url:'https://www.zhipin.com/job_detail/x1.html',title:'目标岗位',location:'杭州·西湖区'}]});
  assert.equal(chosen.gate,'ok','已选岗位但无可比对面板链接时不误判冲突');
});
for(const gate of ['challenge','login_required'])test(`BOSS未选岗位的首页仍检查${gate}`,()=>{
  const dom=createBossVisibleDom({document:{body:{innerText:'站点门槛'},querySelectorAll:()=>[]},window:{getComputedStyle:()=>({display:'block',visibility:'visible'})},location:{href:'https://www.zhipin.com/web/geek/jobs'},extractPage:({kind})=>kind==='listing'?{status:gate,jobs:[]}:{status:'ok'},policy:createBossBatchPolicy()});
  assert.equal(dom.snapshot({id:'b',city:'南京',keyword:'AI Agent',jobs:[],records:[],stage:'opening'}).gate,gate);
});
test('BOSS城市字母分组映射按拼音首字母且只覆盖四城',()=>{
  const dom=createBossVisibleDom({document:{body:{innerText:'x'},querySelectorAll:()=>[]},window:{getComputedStyle:()=>({display:'block',visibility:'visible'})},location:{href:'https://www.zhipin.com/web/geek/jobs'},extractPage:()=>({status:'ok',jobs:[]}),policy:createBossBatchPolicy()});
  assert.equal(dom.cityLetterLabel('上海'),'PQRST');
  assert.equal(dom.cityLetterLabel('杭州'),'FGHJ');
  assert.equal(dom.cityLetterLabel('南京'),'KLMN');
  assert.equal(dom.cityLetterLabel('福州'),'FGHJ');
  assert.equal(dom.cityLetterLabel('成都'),null,'非计划城市不得猜测分组');
  assert.equal(dom.cityLetterLabel(''),null);
});
