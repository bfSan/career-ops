// BOSS visible DOM adapter and runtime. It never constructs search URLs or dispatches synthetic events.
export function createBossVisibleDom({window,document,location,history,extractPage,policy,now=()=>Date.now()}) {
  const visible=element=>!!element&&element.getClientRects?.().length&&window.getComputedStyle(element).visibility!=='hidden'&&window.getComputedStyle(element).display!=='none';
  const text=element=>visible(element)?String(element.innerText||'').trim():'';
  const all=(root,selector)=>[...root.querySelectorAll(selector)].filter(visible);
  const safe=value=>{try{const url=new URL(value,location.href);return url.protocol==='https:'&&['www.zhipin.com','zhipin.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port?url:null;}catch{return null;}};
  const jobUrl=value=>{const url=safe(value);return url&&/^\/job_detail\/[\w-]+\.html$/.test(url.pathname)?`https://www.zhipin.com${url.pathname}`:null;};
  const input=()=>{const candidates=all(document,'input.ipt-search,input[name="query"],input[placeholder*="职位"],input[placeholder*="搜索"],input[type="text"]').filter(element=>element.type!=='password');return candidates.length===1?candidates[0]:null;};
  const button=()=>{const candidates=all(document,'button,a,[role="button"],div,span').filter(element=>text(element)==='搜索');const leaves=candidates.filter(element=>!candidates.some(other=>other!==element&&element.contains(other)));return leaves.length===1?leaves[0]:null;};
  const leaves=items=>items.filter(element=>!items.some(other=>element!==other&&element.contains(other)));
  let observedCityControl=null;
  const cityControl=()=>{
    if(observedCityControl?.isConnected&&visible(observedCityControl))return observedCityControl;
    const candidates=leaves(all(document,'button,[role="button"],div,span').filter(element=>
      !element.closest('.job-detail-container,.job-card-wrap,.job-card-box,.job-list-box')&&
      /(city|location|area|filter)/i.test(`${element.className||''} ${element.getAttribute('aria-label')||''}`)&&
      /^(?:城市|全国|上海|杭州|南京|福州)$/.test(text(element))));
    observedCityControl=candidates.length===1?candidates[0]:null;
    return observedCityControl;
  };
  const compact=value=>String(value||'').replace(/\s+/g,'');
  const cityLetterLabel=city=>({上海:'PQRST',杭州:'FGHJ',南京:'KLMN',福州:'FGHJ'}[String(city||'').trim()]||null);
  // Limit city options to the rendered city dialog. Background job locations
  // remain visible to getClientRects even when covered by the modal overlay.
  const cityDialog=()=>{
    const titles=leaves(all(document,'h1,h2,h3,h4,div,span,p').filter(e=>text(e)==='请选择城市'));
    const roots=[];
    for(const title of titles){
      for(let root=title.parentElement;root&&root!==document.body&&root!==document.documentElement;root=root.parentElement){
        const labels=all(root,'button,a,li,[role="tab"],span,div').map(e=>compact(text(e)));
        if(labels.includes('KLMN')&&labels.includes('FGHJ')){roots.push(root);break;}
      }
    }
    const unique=[...new Set(roots)];return unique.length===1?unique[0]:null;
  };
  const cityCandidates=(city,root=cityDialog())=>root?leaves(all(root,'button,a,li,[role="option"],[role="menuitem"],span,div').filter(e=>text(e)===city)):[];
  const cityLetterTab=(city,root=cityDialog())=>{
    const label=cityLetterLabel(city);if(!root||!label)return null;
    const matches=leaves(all(root,'button,a,li,[role="tab"],[role="menuitem"],span,div').filter(e=>compact(text(e))===label));
    return matches.length===1?matches[0]:null;
  };
  const selectedCity=()=>{const label=text(cityControl());return policy.cities.includes(label)?label:'';};
  const snapshot=batch=>{
    const currentUrl=location.href,url=safe(currentUrl),searchInput=input(),searchButton=button();
    const listingResult=extractPage({platform:'boss',kind:'listing'});
    const expected=batch.jobs?.[batch.records.length];
    // Panel identity is only meaningful once this batch has chosen a concrete job.
    // Before that (opening/search/city), BOSS may show an unrelated default panel.
    const expectedId=expected?new URL(expected.url).pathname.match(/^\/job_detail\/([\w-]+)\.html$/)?.[1]:null;
    const panelResult=expectedId?extractPage({platform:'boss',kind:'panel',expected:{...expected,id:expectedId}}):{status:'ok',job:null};
    const activeLinks=expectedId?all(document,'.job-card-wrap.active a.job-name').map(element=>jobUrl(element.href)).filter(Boolean):[];
    const moreLinks=expectedId?all(document,'.job-detail-container .more-job-btn').map(element=>jobUrl(element.href)).filter(Boolean):[];
    const panelConflict=!!expectedId&&(activeLinks.length||moreLinks.length)>0&&(activeLinks.length!==1||moreLinks.length!==1||activeLinks[0]!==moreLinks[0]);
    const panelUrl=!panelConflict&&panelResult.status==='ok'?activeLinks[0]||null:null;
    const observedAt=new Date(now()).toISOString();
    const panelEvidence=panelUrl&&panelResult.job?{jobUrl:panelUrl,title:panelResult.job.title||'',location:panelResult.job.location||'',at:observedAt}:null;
    if(panelResult.job&&panelUrl)panelResult.job.url=panelUrl;
    const panelLocation=panelResult.job?.location||'';
    // Only when the panel shows no region at all may this same job's visible
    // listing card supply it, and the record says so explicitly.
    const useListingLocation=!panelLocation&&!!expected?.location;
    const record=panelResult.status==='ok'&&panelResult.job&&expected&&panelEvidence?{...panelResult.job,platform:'boss',url:panelResult.job.url,...(useListingLocation?{location:expected.location,locationSource:'listing_card'}:{locationSource:'detail_panel'}),complete:true,captureMethod:'browser_extension',observedAt,sourceText:panelResult.job.description||'',searchContext:{batchId:batch.id,city:batch.city,keyword:batch.keyword,listingHref:batch.evidence?.href,captureMode:batch.stage==='panel-probe'?'current_panel':'clicked_panel',panelEvidence}}:null;
    const dialog=cityDialog(),options=cityCandidates(batch.city,dialog);
    const gate=[listingResult.status,panelResult.status].find(status=>['challenge','login_required'].includes(status))||(panelConflict?'identity_conflict':'ok');
    return {href:currentUrl,blank:!String(document.body?.innerText||'').trim(),gate,inputValue:searchInput?.value||'',searchInput:!!searchInput,searchButton:!!searchButton,query:url?.searchParams.get('query')||'',cityParam:url?.searchParams.get('city')||'',selectedCity:selectedCity(),cityControl:!!cityControl(),exactCityOption:options.length===1,cityOptionCount:options.length,cityLetterTab:options.length===0&&!!cityLetterTab(batch.city,dialog),cityLabels:dialog?[...new Set(all(dialog,'button,a,li,span,div').map(e=>compact(text(e))).filter(t=>/^[A-Z]{2,6}$/.test(t)))]:[],cityDialogVisible:!!dialog,jobs:listingResult.jobs||[],record,card:null};
  };
  const nativeValue=(element,value)=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('BOSS缺少原生value setter');setter.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));element.dispatchEvent(new window.Event('change',{bubbles:true}));};
  const prepare=(kind,batch)=>{
    const initial=snapshot(batch),href=location.href;let element;
    if(kind==='keyword-input')element=input();
    if(kind==='search')element=button();
    if(kind==='city-open')element=cityControl();
    if(kind==='city-select'){const options=cityCandidates(batch.city);if(options.length!==1)throw Error('BOSS弹窗城市选项缺失或不唯一');element=options[0];}
    if(kind==='city-letter')element=cityLetterTab(batch.city);
    if(kind==='job-click'){
      const expected=batch.jobs[batch.records.length];
      const matches=all(document,'a.job-name[href*="/job_detail/"]').filter(anchor=>jobUrl(anchor.href)===jobUrl(expected?.url));
      if(matches.length!==1||text(matches[0])!==expected.title)throw Error('BOSS可见岗位卡片身份不唯一或已变化');
      element=matches[0];initial.card={url:jobUrl(element.href),title:text(element)};
    }
    if(!visible(element)) {
      let diagnostics=[];
      if(kind==='city-open')diagnostics=all(document,'button,[role="button"],div,span').filter(e=>/^(?:城市|全国|上海|杭州|南京|福州)$/.test(text(e))).slice(0,12).map(e=>({tag:e.tagName,cls:String(e.className||'').slice(0,60),text:text(e),inJob:!!e.closest('.job-detail-container,.job-card-wrap,.job-card-box,.job-list-box')}));
      if(kind==='city-letter')diagnostics={wanted:cityLetterLabel(batch.city),uppercaseLabels:all(document,'button,a,li,[role="tab"],[role="menuitem"],span,div').map(e=>text(e)).filter(t=>/^[A-Z]{2,6}$/.test(t)).slice(0,8)};
      throw Error(`BOSS动作控件缺失：${kind} ${JSON.stringify(diagnostics)}`);
    }
    return {snapshot:initial,perform(){
      if(location.href!==href)throw Error('BOSS文档或导航发生变化');
      const current=snapshot(batch);if(current.blank||current.gate!=='ok')throw Error('BOSS页面门槛或空白');
      if(!element.isConnected||!visible(element))throw Error('BOSS动作控件已被替换');
      if(kind==='city-letter'&&cityLetterTab(batch.city)!==element)throw Error('BOSS字母分组已改变或不唯一');
      if(kind==='city-select'){const options=cityCandidates(batch.city);if(options.length!==1||options[0]!==element)throw Error('BOSS城市选项已改变或不唯一');}
      if(kind==='keyword-input')nativeValue(element,batch.keyword);
      else if(kind==='job-click'&&jobUrl(element.getAttribute('href'))!==jobUrl(batch.jobs[batch.records.length]?.url))throw Error('BOSS岗位身份变化');
      else {if(element.tagName==='A')element.removeAttribute('target');element.click();}
    }};
  };
  return {snapshot,prepare,show:()=>{},cityLetterLabel};
}

export function createBossVisibleRuntime({chrome,dom,href,now=()=>Date.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}) {
  let busy=false,timer=null,current=null;
  const send=message=>chrome.runtime.sendMessage(message);
  const base=batch=>({batchId:batch.id,revision:batch.revision,stage:batch.stage,href:href()});
  const halt=async(batch,reason)=>{const result=await send({type:'HALT',...base(batch),reason});current=result?.batch||current;};
  async function tick(){
    if(busy)return{skipped:true};busy=true;
    try{
      const hello=await send({type:'HELLO',href:href()});if(!hello?.owner)return{owner:false};current=hello.batch;if(!hello.ok||current?.status!=='running')return{terminal:true};
      const batch=current,snapshot=dom.snapshot(batch);
      if(snapshot.blank||snapshot.gate!=='ok'){await halt(batch,snapshot.gate||'blank');return{halted:true};}
      if(['opening','search-await','city-menu-await','city-letter-await','city-await','panel-await'].includes(batch.stage)&&now()-Date.parse(batch.stageSince||batch.startedAt)>90000){await halt(batch,'BOSS阶段等待超时 '+JSON.stringify({stage:batch.stage,dialog:snapshot?.cityDialogVisible,labels:snapshot?.cityLabels,letterTab:!!snapshot?.cityLetterTab,exactCity:!!snapshot?.exactCityOption}).slice(0,300));return{halted:true};}
      if(['opening','search-await','city-menu-await','city-letter-await','city-await','listing-ready','panel-probe','panel-await'].includes(batch.stage)){
        const result=await send({type:'OBSERVE',...base(batch),snapshot});current=result?.batch||current;return result;
      }
      let kind;
      if(batch.stage==='keyword-ready')kind='keyword-input';
      else if(batch.stage==='keyword-filled')kind='search';
      else if(batch.stage==='city-ready')kind='city-open';
      else if(batch.stage==='city-select-ready')kind='city-select';
      else if(batch.stage==='city-letter-ready')kind='city-letter';
      else if(batch.stage==='job-ready')kind='job-click';
      else {await halt(batch,'BOSS未知阶段，禁止自动恢复');return{halted:true};}
      const prepared=dom.prepare(kind,batch);const reservation=await send({type:'RESERVE',...base(batch),kind,snapshot:prepared.snapshot,...(kind==='job-click'?{jobUrl:batch.jobs[batch.records.length]?.url}:{})});current=reservation?.batch||current;if(!reservation?.ok)return reservation;
      const checked=await send({type:'CHECK_ACTION',...base(reservation.batch),token:reservation.token});if(!checked?.ok)return checked;prepared.perform();return{ok:true,action:kind};
    }catch(error){if(current?.status==='running')await halt(current,error.message);return{error:error.message};}finally{busy=false;}
  }
  function start(){if(timer)return;const loop=async()=>{timer=null;await tick();timer=schedule(loop,800);};timer=schedule(loop,0);}
  return {tick,start,dispose(){if(timer!==null)cancel(timer);timer=null;}};
}
