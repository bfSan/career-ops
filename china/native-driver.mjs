import {createNativeLiepinDriver} from './native-liepin-driver.mjs';
import {createNativePageDriver} from './native-page-driver.mjs';
import {openNativeLogin} from './native-login.mjs';
import {createCdpBridge} from './cdp-bridge.mjs';
import {extractPage,validateSearchUrl,jobIdentity} from './platforms.mjs';
import {normalizeSalary,loadNativeSalaryFont} from './salary.mjs';

// This function is serialized into Chrome's Apple Events isolated world.
// Limit interaction to the exact observed job-name anchor. Prevent its default
// standalone navigation while retaining the site's card-selection listener.
function selectCard({id,title,click}){
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const anchors=[...document.querySelectorAll('.job-card-wrap .job-card-box a.job-name')].filter(a=>a.getAttribute('href')===`/job_detail/${id}.html`&&visible(a));
  if(anchors.length!==1)return {status:'extraction_failed'};
  const a=anchors[0],actual=a.innerText.trim();
  if(!actual||(title&&actual!==title)||a.hasAttribute('target'))return {status:'extraction_failed'};
  if(a.closest('.job-card-box').classList.contains('is-close'))return {status:'closed',evidence:{field:'class',quote:'is-close'}};
  if(click){a.addEventListener('click',e=>e.preventDefault(),{once:true});a.click();}
  return {status:'ok',title:actual};
}
function advanceList(){
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  for(const selector of ['.ant-pagination-next','.options-pages .next','.pagination-next','a.next','button.next','[aria-label="下一页"]','[title="下一页"]']){
    const button=[...document.querySelectorAll(selector)].find(visible);
    if(!button)continue;
    if(button.disabled||/disabled/.test(button.className)||button.getAttribute('aria-disabled')==='true')return {status:'end'};
    // Native collection supports in-page controls only; links with a destination
    // are not clicked without a verified platform pagination implementation.
    if(button.tagName==='A'&&button.getAttribute('href')&&!['#','javascript:;','javascript:void(0)'].includes(button.getAttribute('href')))return {status:'pagination_unavailable'};
    button.click();return {status:'ok'};
  }
  const list=document.querySelector('.job-list-container,.job-list-box');
  const parents=[];for(let node=list;node;node=node.parentElement)parents.push(node);
  // The current search layout scrolls the document with overflow:visible.
  // Only use the document when it contains the observed list, never the JD panel.
  const scroll=parents.find(node=>node.scrollHeight>node.clientHeight+20&&/auto|scroll/.test(getComputedStyle(node).overflowY))
    || (parents.includes(document.scrollingElement)?document.scrollingElement:null);
  if(scroll){const before=scroll.scrollTop;scroll.scrollTop=scroll.scrollHeight;if(scroll.scrollTop!==before)return {status:'ok'};}
  return {status:/没有更多职位|没有更多了|已显示全部职位/.test(document.body?.innerText||'')?'end':'pagination_unavailable'};
}

export async function createNativeDriver({root,platform='boss',channel='chrome',delayMs=15000,timeoutMs=15000,pollMs=250,onEvent=()=>{},sessionFactory=openNativeLogin,bridgeFactory=createCdpBridge,automaticVerificationTimeoutMs=15000}){
  if(platform==='liepin')return createNativeLiepinDriver({root,platform,channel,delayMs,timeoutMs,pollMs,onEvent,sessionFactory,bridgeFactory});
  if(platform==='linkedin')return createNativePageDriver({root,platform,channel,delayMs,timeoutMs,pollMs,onEvent,sessionFactory,bridgeFactory});
  const fontAttempts=new Set();let fonts=[];const requests=[];
  if(platform!=='boss'||channel!=='chrome')throw new Error('Native scanning currently supports BOSS with Chrome only');
  let session,bridge,tab,blocked,closing,search='',requestedSearch='',lastSignature='',challengeDeadline=null,challengeSeen=false,challengeSettled=false;
  const searchKey=value=>{
    const url=new URL(validateSearchUrl('boss',value));
    // BOSS adds this documented-in-session return marker after its own check.
    // All user query/filter parameters still have to match exactly.
    url.searchParams.delete('_security_check');url.searchParams.sort();return url.href;
  };
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const signature=data=>(data.jobs||[]).map(j=>j.url.split('?')[0]).sort().join('|');
  const close=()=>closing||=(async()=>{if(session)await session.close();})();
  const stop=async status=>{blocked||={status};await close();return blocked;};
  const current=async()=>{
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
    if(tabs.length!==1){onEvent({event:'native_tab_inventory_changed',platform,tabCount:tabs.length,expectedTabBound:!!tab});return stop(tabs.length?'unexpected_browser_tab':'browser_closed');}
    if(!tab)tab={windowId:tabs[0].windowId,tabId:tabs[0].tabId};
    const live=tabs.find(t=>t.windowId===tab.windowId&&t.tabId===tab.tabId);
    if(!live){onEvent({event:'native_bound_tab_missing',platform,tabCount:tabs.length});return stop('browser_closed');}
    if(live.url==='about:blank')return stop('blank_page');
    if(/\/security(?:\.html|\/)|\/captcha(?:\/|$)/.test(live.url)){
      // BOSS gates the first search with one automatic check: it rewrites the URL
      // with a _security_check marker, bounces through security.html and returns
      // to the same listing on its own. Measured 2026-10-02 with a logged-in
      // profile on this host: the round trip cleared in about twelve seconds with
      // no interaction and then served the real cards, so the earlier eight-second
      // window expired just before the check completed.
      // The driver still never drives the page - no click, no reload, no replay -
      // and this keeps the contract navigation-guard.mjs already applies to the
      // Playwright route: let the site complete a single code-37 check inside a
      // bounded window, then stop on any second entry or timeout. Fifteen seconds
      // is a declared budget recorded in docs/COLLECTION_RULES.md; waiting on the
      // site adds zero requests, so it is not a retry budget.
      if(!search&&!challengeSeen){
        challengeSeen=true;
        challengeDeadline=Date.now()+automaticVerificationTimeoutMs;
        onEvent({event:'native_challenge_pending',platform,timeoutMs:automaticVerificationTimeoutMs});
      }
      // Only the first entry is tolerated, and only inside the bounded window.
      // A second entry - which is what a failed check looks like - stops at once.
      if(!search&&!challengeSettled&&challengeDeadline!==null&&Date.now()<challengeDeadline)return {status:'challenge_pending'};
      return stop('challenge');
    }
    // Reaching a usable URL means the one permitted check is definitively over.
    if(challengeSeen)challengeSettled=true;
    challengeDeadline=null;
    let value;try{value=validateSearchUrl('boss',live.url);}catch{return stop('navigation_changed');}
    if(!search&&searchKey(value)!==requestedSearch)return stop('navigation_changed');
    if(search&&value!==search)return stop('navigation_changed');
    challengeDeadline=null;
    return {status:'ok',url:live.url};
  };
  const evaluate=async(fn,args)=>{
    const state=await current();if(state.status!=='ok')return state;
    const source=`JSON.stringify((()=>{
      if(${!search&&fn===extractPage&&args?.kind==='listing'}&&location.href==='about:blank')return {status:'starting'};
      if(location.href!==${JSON.stringify(state.url)})return {status:/\\/security(?:\\.html|\\/)|\\/captcha(?:\\/|$)/.test(location.pathname)?'challenge':'navigation_changed'};
      const gate=(${extractPage.toString()})({platform:'boss',kind:'state'});
      if(['challenge','login_required'].includes(gate.status))return gate;
      return (${fn.toString()})(${JSON.stringify(args)});
    })())`;
    const result=await bridge.evaluate(tab,source);
    if(!result||typeof result.status!=='string')return {status:'extraction_failed'};
    if(result.status==='challenge_pending')return result;
    // Route every challenge through current(), which owns the bounded startup
    // grace. A challenge discovered inside the page script must not bypass it.
    if(result.status==='challenge'){
      const state=await current();
      if(state.status==='challenge_pending')return state;
      return stop('challenge');
    }
    if(['login_required','navigation_changed'].includes(result.status))return stop(result.status);
    return result;
  };
  const wait=async()=>{
    const until=Date.now()+delayMs;
    while(Date.now()<until){
      if(session){
        const state=await evaluate(extractPage,{platform:'boss',kind:'state'});
        // A pending security check is a transient page state, not a result:
        // keep polling so the check can clear, and never treat it as success.
        if(state.status!=='ok'&&state.status!=='challenge_pending')return state;
      }
      await pause(Math.min(pollMs,Math.max(0,until-Date.now())));
    }
    // The window elapsed. If a check is still pending it is now terminal, and
    // current() will say so on the next read.
    if(challengeDeadline!==null&&Date.now()>=challengeDeadline)return (await current());
    return blocked||{status:'ok'};
  };
  const read=async(kind,expected,previous='')=>{
    const until=Date.now()+timeoutMs;let result;
    do{
      result=await evaluate(extractPage,{platform:'boss',kind,expected});
      if(result.status==='ok'&&(!previous||signature(result)!==previous))return result;
      // 'challenge_pending' keeps polling: the check may still be clearing.
      if(!['ok','extraction_failed','starting','challenge_pending'].includes(result.status))return result;
      await pause(pollMs);
      // A clearing security check outlives the ordinary read budget, so while one
      // is pending let the read run to the challenge deadline instead. The bound
      // is the deadline itself; nothing here is unbounded or retried.
    }while(Date.now()<until||(result.status==='challenge_pending'&&challengeDeadline!==null&&Date.now()<challengeDeadline));
    return result.status==='ok'?{status:'repeated_page'}:result.status==='starting'?{status:'extraction_failed'}:result;
  };
  const decorate=async(result,expected)=>{
    if(result.status!=='ok'||!result.job)return result;
    const job=result.job;
    const boundFonts=value=>fonts.filter(font=>font.stylesheet?value.salaryFontStylesheets?.includes(font.stylesheet.url):value.salaryFontUrls?.includes(font.url));
    const fontKey=JSON.stringify([job.salaryFontUrls||[],job.salaryFontStylesheets||[]]);
    if(!boundFonts(job).length&&!fontAttempts.has(fontKey)&&/[\uE000-\uF8FF]/.test(job.salaryRaw||'')&&job.salaryFontLoaded&&(job.salaryFontUrls?.length||job.salaryFontStylesheets?.length)){
      fontAttempts.add(fontKey);
      fonts.push(...await loadNativeSalaryFont(job,{wait:async()=>{const state=await wait();if(state.status!=='ok')throw new Error(state.status);},onEvent:event=>{requests.push(event);onEvent(event);}}));
      if(blocked)return blocked;
      result=await evaluate(extractPage,{platform:'boss',kind:'panel',expected});
      if(result.status!=='ok'||!result.job)return result;
    }
    return {...result,job:{...normalizeSalary(result.job,boundFonts(result.job)),url:expected.url}};
  };
  const safe=fn=>async(...args)=>{
    if(blocked)return blocked;
    try{return await fn(...args);}catch(error){
      onEvent({event:'native_browser_error',platform,status:error.status||'network_error',bridgeErrorCode:error.bridgeErrorCode??null,bridgeErrorStage:error.bridgeErrorStage??null,message:error.message});
      return stop(error.status||'network_error');
    }
  };
  const next=safe(async()=>{
    const waited=await wait();if(waited.status!=='ok')return waited;
    const moved=await evaluate(advanceList);if(moved.status!=='ok')return moved;
    const result=await read('listing',undefined,lastSignature);
    if(result.status==='ok')lastSignature=signature(result);
    return result;
  });
  return {
    listing:safe(async(url,pageIndex=0)=>{
      url=validateSearchUrl('boss',url);
      // collect() calls listing once per driver. A resumed CLI run gets a new
      // driver using the same profile; never race setURL against an old DOM.
      if(session)return stop('driver_already_started');
      requestedSearch=searchKey(url);
      const waited=await wait();if(waited.status!=='ok')return waited;
      session=await sessionFactory({root,platform:'boss',channel,url});
      session.closed?.then(()=>{if(!closing)blocked||={status:'browser_closed'};});
      bridge=await bridgeFactory({root,session,onEvent});
      onEvent({event:'native_browser_started',platform,debugger:true});
      let result=await read('listing');
      if(result.status==='ok'){search=validateSearchUrl('boss',result.url);lastSignature=signature(result);}
      for(let i=0;i<pageIndex&&result.status==='ok';i++)result=await next();
      return result;
    }),
    detail:safe(async card=>{
      const identity=jobIdentity('boss',card.url);
      let target=await evaluate(selectCard,{id:identity.id,title:card.title});
      if(target.status!=='ok')return target.status==='closed'?{...target,boundUrl:identity.url}:target;
      const expected={...identity,title:target.title};
      const selected=await evaluate(extractPage,{platform:'boss',kind:'panel',expected});
      if(selected.status==='ok')return decorate(selected,expected);
      if(!['extraction_failed'].includes(selected.status))return selected.status==='closed'?{...selected,boundUrl:identity.url}:selected;
      const waited=await wait();if(waited.status!=='ok')return waited;
      target=await evaluate(selectCard,{id:identity.id,title:target.title,click:true});
      if(target.status!=='ok')return target.status==='closed'?{...target,boundUrl:identity.url}:target;
      const result=await read('panel',expected);
      return result.status==='closed'?{...result,boundUrl:identity.url}:decorate(result,expected);
    }),
    next,close,requestLog:()=>structuredClone(requests),
  };
}
