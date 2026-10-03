import {nextControl,searchIdentity,searchPageIdentity,validateNextUrl} from './pagination.mjs';
import {openNativeLogin} from './native-login.mjs';
import {createCdpBridge} from './cdp-bridge.mjs';
import {extractPage,jobIdentity,validateSearchUrl,platformUrl} from './platforms.mjs';
import {expandDescription} from './detail-controls.mjs';
import {findCard,clickCard} from './card-click.mjs';

// Standalone detail pages share this lifecycle; BOSS retains its panel driver.
export async function createNativePageDriver({root,platform='liepin',channel='chrome',delayMs=15000,timeoutMs=15000,pollMs=250,onEvent=()=>{},sessionFactory=openNativeLogin,bridgeFactory=createCdpBridge}) {
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
    // The DevTools inventory can transiently miss a live tab while Chrome
    // swaps a target. Re-read once without navigation; never rebind an
    // established tab or retry errors.
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
   // A navigation in flight destroys the context this would run in, and the
   // read is not wrong — it is early. The loop below already retries until the
   // timeout, so catching it here is the same bounded wait without charging
   // the run a spurious network_error. Only a destroyed context is forgiven;
   // every other evaluation failure still propagates.
   let result;
   try{result=await evaluate(kind);}
   catch(error){
    if(navigating&&/Execution context was destroyed|Cannot find context/i.test(error.message)){await pause(pollMs);continue;}
    throw error;
   }
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
     // The document now being read, so a later click can tell a fresh document
     // from this one without re-sampling — a fresh evaluation races the
     // tail of the previous navigation and dies on a destroyed context.
     previousOrigin=result.timeOrigin;
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
  // previousOrigin already describes the document being left: read() refreshes
  // it on every successful read. Re-sampling here would race the tail of the
  // last navigation and can die on a destroyed context instead of navigating.
  previousUrl=boundUrl;navigating=true;
  try{await bridge.navigate(tab,url);return await read(kind,expected,previousSignature);}finally{navigating=false;}
 }
 // 猎聘 only serves a job page when the arrival looks like it came from the
 // results list, so the card is clicked rather than navigated to. See
 // china/card-click.mjs for what the site actually keys on.
 //
 // Locating and clicking are separate evaluations on purpose: a script that
 // clicks and returns in one call is destroyed by the navigation its own click
 // causes, and the driver only sees the resulting exception.
 async function clickThrough(url,kind,expected){
  // previousOrigin/previousUrl come from the listing we are already standing
  // on — boundUrl and the last read recorded them. Re-sampling the document
  // here would be a fresh evaluation racing the tail of the previous
  // navigation, and read() already compares timeOrigin against previousOrigin
  // to tell a new document from the old one.
  previousUrl=boundUrl;navigating=true;
  try{
   const found=await bridge.evaluate(tab,`JSON.stringify((${findCard.toString()})({platform:${JSON.stringify(platform)},url:${JSON.stringify(url)}}))`);
   if(found.status==='closed')return stop('closed');
   // Ambiguous and not-found are extraction failures, not page verdicts: the
   // listing could not be trusted to name the job that was asked for.
   if(found.status!=='found')return stop('extraction_failed');
   // Fire-and-forget: the click navigates, so its context dies before any
   // value could be marshalled back. read() below observes the arrival.
   const run=bridge.evaluateVoid||((t,src)=>bridge.evaluate(t,src));
   await run(tab,`(${clickCard.toString()})({index:${found.index}})`);
   return await read(kind,expected);
  }finally{navigating=false;}
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
   bridge=await bridgeFactory({root,session});onEvent({event:'native_browser_started',platform,debugger:true});
   let result=await read('listing',search);
   for(let i=0;i<pageIndex&&result.status==='ok';i++)result=await next();
   return result;
  }),
  detail:safe(async card=>{
   const expected=jobIdentity(platform,card.url),observed=cards.get(expected.key);
   if(!observed||observed.title!==card.title)return stop('identity_mismatch');
   const waited=await wait();if(waited.status!=='ok')return waited;
   const state=await current();if(state.status!=='ok')return state;
   // A click-through leaves the tab on the job page, so the next card is out
   // of reach until the listing is back. Navigating to listUrl is enough: it
   // is the listing's own address, session query included, which is what the
   // next click needs. next() already restores the listing the same way after
   // a page turn, and the signature check keeps a silently-changed listing
   // from being mistaken for the one the run approved.
   if(platform==='liepin'&&boundUrl&&boundUrl!==listUrl){
    const saved=lastSignature,restored=await navigate(listUrl,'listing',listUrl);
    if(restored.status!=='ok')return restored;
    if(lastSignature!==saved)return stop('resume_page_changed');
    const gap=await wait();if(gap.status!=='ok')return gap;
   }
   // 猎聘 ties a job page to the list it was reached from, so it is clicked
   // through. LinkedIn's detail URLs carry no such binding and still navigate.
   return platform==='liepin'
    ?clickThrough(observed.url,'detail',expected)
    :navigate(observed.url,'detail',expected);
  }),next,close,
 };
}
