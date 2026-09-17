import {nextControl,searchIdentity,searchPageIdentity,validateNextUrl} from './pagination.mjs';
import {openNativeLogin} from './native-login.mjs';
import {createNativeBridge} from './native-bridge.mjs';
import {extractPage,jobIdentity,validateSearchUrl,platformUrl} from './platforms.mjs';
import {expandDescription} from './detail-controls.mjs';

// Standalone detail pages share this lifecycle; BOSS retains its panel driver.
export async function createNativePageDriver({root,platform='liepin',channel='chrome',delayMs=15000,timeoutMs=15000,pollMs=250,onEvent=()=>{},sessionFactory=openNativeLogin,bridgeFactory=createNativeBridge}) {
 if(channel!=='chrome')throw new Error('Native scanning requires Chrome');
 let session,bridge,tab,closing,blocked,search='',listUrl='',lastSignature='',previousUrl='',previousOrigin=null,boundUrl='',navigating=false,platformVisited=false;
 const cards=new Map(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const key=value=>searchIdentity(platform,value);
 const signature=result=>(result.jobs||[]).map(j=>jobIdentity(platform,j.url).key).sort().join('|');
 const close=()=>closing||=(async()=>{if(session)await session.close();})();
 const stop=async status=>{blocked||={status};await close();return blocked;};
 async function current(){
  if(blocked)return blocked;
  let tabs=await bridge.tabs();
    // Apple Events can transiently return an empty inventory for a live tab.
    // Re-read once without navigation; never rebind an established tab or retry errors.
    if(!tabs.length&&tab&&!blocked){
      await pause(250);
      if(blocked)return blocked;
      tabs=await bridge.tabs();
      if(tabs.length===1&&tabs[0].windowId===tab.windowId&&tabs[0].tabId===tab.tabId)
        onEvent({event:'native_tab_inventory_recovered',platform});
    }
    if(blocked)return blocked;
  if(!tabs.length&&!tab)return {status:'starting'};
  if(tabs.length!==1){onEvent({event:'native_tab_inventory_changed',platform,tabCount:tabs.length,expectedTabBound:!!tab});return stop(tabs.length?'unexpected_browser_tab':'browser_closed');}
  if(!tab)tab={windowId:tabs[0].windowId,tabId:tabs[0].tabId};
  const live=tabs.find(t=>t.windowId===tab.windowId&&t.tabId===tab.tabId);if(!live){onEvent({event:'native_bound_tab_missing',platform,tabCount:tabs.length});return stop('browser_closed');}
  if(!platformVisited&&['about:blank','chrome://newtab/','chrome://new-tab-page/'].includes(live.url))return {status:'starting'};
  if(live.url==='about:blank')return stop('blank_page');
  let u;try{u=new URL(live.url);}catch{return stop('navigation_changed');}
  if(platform==='liepin'&&(u.hostname==='safe.liepin.com'||/(?:security|captcha)/i.test(u.pathname)))return stop('challenge');
  if(platform==='liepin'&&u.hostname==='wow.liepin.com'&&u.pathname==='/t1012695/4410f519.html')return stop('login_required');
  if(platform==='linkedin'&&/\/(?:checkpoint|challenge|authwall)(?:\/|$)/i.test(u.pathname))return stop(u.pathname.includes('authwall')?'login_required':'challenge');
  if(/(^|\.)liepin\.com$/.test(u.hostname)&&/passport|login/i.test(u.hostname+u.pathname))return stop('login_required');
  if(platform==='linkedin'&&/\/(?:login|uas\/login)(?:\/|$)/i.test(u.pathname))return stop('login_required');
  if(platform==='linkedin'&&/(^|\.)linkedin\.cn$/.test(u.hostname))return stop('regional_redirect');
  try{platformUrl(platform,live.url);}catch{return stop('navigation_changed');}
  platformVisited=true;
  if(boundUrl&&!navigating&&live.url!==boundUrl)return stop('navigation_changed');
  return {status:'ok',url:live.url};
 }
 const evaluate=kind=>bridge.evaluate(tab,`JSON.stringify((()=>{const result=(${extractPage.toString()})({platform:${JSON.stringify(platform)},kind:${JSON.stringify(kind)}});return {...result,timeOrigin:performance.timeOrigin,documentUrl:location.href};})())`);
 async function wait(){
  const end=Date.now()+delayMs;
  while(Date.now()<end){
   if(session){const s=await current();if(s.status!=='ok')return s;const n=await evaluate('state');if(['challenge','login_required'].includes(n.status))return stop(n.status);}
   await pause(Math.min(pollMs,Math.max(0,end-Date.now())));
  }
  return blocked||{status:'ok'};
 }
 function remember(result){cards.clear();for(const c of result.jobs||[]){try{cards.set(jobIdentity(platform,c.url).key,c);}catch{}}listUrl=result.documentUrl;lastSignature=signature(result);}
 async function read(kind,expected,previousSignature='',expanded=false){
  const end=Date.now()+timeoutMs;
  let lastStatus='extraction_failed';
  do{
   const state=await current();if(state.status==='starting'){await pause(pollMs);continue;}if(state.status!=='ok')return state;
   const result=await evaluate(kind);
   lastStatus=result.status;
   if(['challenge','login_required'].includes(result.status))return stop(result.status);
   // Chrome may expose the requested address before its first document commits.
   // Only wait for this initial blank document; never relax an established binding.
   if(kind==='listing'&&!boundUrl&&!navigating&&result.documentUrl==='about:blank'){
    await pause(pollMs);continue;
   }
   let matches=false;
   try{matches=kind==='listing'?key(result.documentUrl)===key(search)&&(!expected||searchPageIdentity(platform,result.documentUrl)===searchPageIdentity(platform,expected)):jobIdentity(platform,result.documentUrl).key===expected.key;}catch{}
   if(!matches){if(navigating&&result.documentUrl===previousUrl){await pause(pollMs);continue;}return stop('identity_mismatch');}
   if(kind==='detail'&&result.timeOrigin===previousOrigin){await pause(pollMs);continue;}
   if(platform==='linkedin'&&kind==='detail'&&result.status==='jd_truncated'&&!expanded){
    expanded=true;const gap=await wait();if(gap.status!=='ok')return gap;
    await bridge.evaluate(tab,`JSON.stringify((${expandDescription.toString()})())`);
    // Expansion may require the normal page rendering timeout after the rate-limit wait.
    return readExpanded();
   }
   if(kind==='listing'&&result.status==='ok'&&previousSignature&&signature(result)===previousSignature){await pause(pollMs);continue;}
   if(result.status==='ok'||result.status==='closed'||result.status==='empty'||result.status==='source_insufficient'){
    boundUrl=result.documentUrl;
    if(kind==='listing'){if(result.status==='ok')remember(result);return result;}
    return result.status==='closed'?{...result,boundUrl:expected.url}:{...result,job:{...result.job,url:expected.url}};
   }
   await pause(pollMs);
  }while(Date.now()<end);
  return stop(previousSignature?'repeated_page':lastStatus==='jd_truncated'?'jd_truncated':'extraction_failed');
  async function readExpanded(){
   // Prevent another expansion attempt even when the site leaves a stale button.
   return read(kind,expected,previousSignature,true);
  }
 }
 async function navigate(url,kind,expected,previousSignature=''){
  const before=await evaluate('state');previousOrigin=before.timeOrigin;previousUrl=before.documentUrl;navigating=true;
  try{await bridge.navigate(tab,url);return await read(kind,expected,previousSignature);}finally{navigating=false;}
 }
 const safe=fn=>async(...args)=>{if(blocked)return blocked;try{return await fn(...args);}catch(error){onEvent({event:'native_browser_error',platform,status:error.status||'network_error',bridgeErrorCode:error.bridgeErrorCode??null,bridgeErrorStage:error.bridgeErrorStage??null,message:error.message});return stop(error.status||'network_error');}};
 const next=safe(async()=>{
  const waited=await wait();if(waited.status!=='ok')return waited;
  const state=await current();if(state.status!=='ok')return state;
  if(boundUrl!==listUrl){
   const saved=lastSignature,restored=await navigate(listUrl,'listing',listUrl);
   if(restored.status!=='ok')return restored;
   if(lastSignature!==saved)return stop('resume_page_changed');
   const gap=await wait();if(gap.status!=='ok')return gap;
  }
  const control=await bridge.evaluate(tab,`JSON.stringify((${nextControl.toString()})())`);
  if(!['target','control'].includes(control.status))return control;
  if(control.status==='target'){
   try{
    validateNextUrl(platform,search,listUrl,control.url);
   }catch{return stop('pagination_identity_mismatch');}
   return navigate(control.url,'listing',control.url,lastSignature);
  }
  previousUrl=boundUrl;navigating=true;
  try{await bridge.evaluate(tab,`JSON.stringify((${nextControl.toString()})({click:true}))`);return await read('listing',undefined,lastSignature);}finally{navigating=false;}
 });
 return {
  listing:safe(async(url,pageIndex=0)=>{
   if(session)return stop('driver_already_started');
   search=validateSearchUrl(platform,url);await wait();
   session=await sessionFactory({root,platform,channel,url:search});
   session.closed?.then(exit=>{if(!closing){onEvent({event:'native_browser_exited',platform,code:exit?.code??null});blocked||={status:'browser_closed'};}});
   bridge=await bridgeFactory({root,session});onEvent({event:'native_browser_started',platform,debugger:false});
   let result=await read('listing',search);
   for(let i=0;i<pageIndex&&result.status==='ok';i++)result=await next();
   return result;
  }),
  detail:safe(async card=>{
   const expected=jobIdentity(platform,card.url),observed=cards.get(expected.key);
   if(!observed||observed.title!==card.title)return stop('identity_mismatch');
   const waited=await wait();if(waited.status!=='ok')return waited;
   const state=await current();if(state.status!=='ok')return state;
   return navigate(observed.url,'detail',expected);
  }),next,close,
 };
}
