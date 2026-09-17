import { chromium } from 'playwright';
import { extractPage, jobIdentity, validateSearchUrl } from './platforms.mjs';
import { guardNavigation } from './navigation-guard.mjs';
import { acquireBrowserProfile } from './browser-profile.mjs';
import { observeSalaryFonts } from './salary.mjs';
import {loadSessionCookies,saveSessionCookies,discardSessionCookies} from './session-cookies.mjs';
import {expandDescription} from './detail-controls.mjs';
import {nextControl,searchIdentity,validateNextUrl} from './pagination.mjs';

export async function openBrowser({root,platform,channel='chrome',headless=false,onEvent=()=>{}}) {
  const profile=await acquireBrowserProfile(root,platform);
  const saved=platform==='boss'?loadSessionCookies(profile.directory,channel):null;
  let context,closing,ownsProfile=true;
  const release=()=>{if(ownsProfile){ownsProfile=false;profile.release();}};
  try {
    context=await chromium.launchPersistentContext(profile.directory,{
      ...(channel==='chromium'?{}:{channel}),headless,locale:'zh-CN',acceptDownloads:false,
      // Native BOSS login uses the OS credential store. Playwright's testing
      // keychain cannot decrypt those cookies, even in the same profile.
      ...(platform==='boss'?{ignoreDefaultArgs:['--use-mock-keychain','--password-store=basic']}:{}),
    });
    const close=context.close.bind(context);
    let cookieRevision=0,activeCookieWrites=0,cacheUnsafe=false;
    const pendingRequests=new Set();
    if(platform==='boss'){
      // Cookie API calls can race shutdown; page keepalive requests can outlive
      // a closed tab. Only remember a quiescent session, never a stale sample.
      for(const method of ['addCookies','clearCookies']){
        const mutate=context[method].bind(context);
        context[method]=async(...args)=>{
          cookieRevision++;activeCookieWrites++;
          try{return await mutate(...args);}finally{cookieRevision++;activeCookieWrites--;}
        };
      }
      context.on('request',request=>{pendingRequests.add(request);if(closing)cacheUnsafe=true;});
      context.on('requestfinished',request=>pendingRequests.delete(request));
      context.on('requestfailed',request=>{pendingRequests.delete(request);cacheUnsafe=true;});
      const watchPage=page=>page.once('close',()=>{if(pendingRequests.size)cacheUnsafe=true;});
      context.pages().forEach(watchPage);
      context.on('page',page=>{watchPage(page);if(closing)cacheUnsafe=true;});
      context.on('serviceworker',()=>{cacheUnsafe=true;});
    }
    context.once('close',()=>{
      if(closing)return;
      // An externally closed browser cannot provide a final live cookie set.
      // Never let a cache from a previous run resurrect deleted session cookies.
      try{if(platform==='boss')discardSessionCookies(profile.directory);}
      catch{onEvent({event:'session_cookie_cache_error',platform,operation:'discard'});}
      finally{release();}
    });
    context.close=(...args)=>{
      if(!ownsProfile)return close(...args);
      return closing ||= (async()=>{
        let cookies=null,sampledRevision;
        if(platform==='boss'){
          if(pendingRequests.size)cacheUnsafe=true;
          try{
            await context.request.dispose();
            await Promise.all(context.pages().map(page=>page.close({runBeforeUnload:false})));
            if(context.serviceWorkers().length)cacheUnsafe=true;
            sampledRevision=cookieRevision;
            if(!cacheUnsafe&&!activeCookieWrites)cookies=await context.cookies();
          }catch{cacheUnsafe=true; /* Browser already exited or could not quiesce. */ }
        }
        try{
          await close(...args);
          if(platform==='boss'){
            if(cookies&&!cacheUnsafe&&!activeCookieWrites&&sampledRevision===cookieRevision)saveSessionCookies(profile.directory,channel,cookies);
            else {
              discardSessionCookies(profile.directory);
              onEvent({event:'session_cookies_not_saved',platform,reason:'session_changed_or_inflight'});
            }
          }
        }catch(error){
          if(platform==='boss')discardSessionCookies(profile.directory);
          throw error;
        }finally{release();}
      })();
    };
    if(saved?.cookies.length){
      const current=await context.cookies();
      const key=c=>`${c.domain}|${c.path}|${c.name}`;
      const present=new Set(current.map(key));
      const missing=saved.cookies.filter(c=>!present.has(key(c)));
      await context.addCookies(missing);
      onEvent({event:'session_cookies_restored',platform,count:missing.length});
    }
    return context;
  }catch(error) {await context?.close().catch(()=>{});release();throw error;}
}

export async function createBrowserDriver({root,platform,context,channel='chrome',headless=false,delayMs=15000,timeoutMs=15000,onEvent=()=>{}}) {
  const owned=!context;
  context ||= await openBrowser({root,platform,channel,headless,onEvent});
  // A persistent context starts with its own blank tab; reuse it instead of
  // leaving a second, unguarded blank tab visible beside the scan.
  const listPage=(owned && context.pages()[0]) || await context.newPage();
  const detailPage=platform==='boss' ? listPage : await context.newPage();
  const pages=[...new Set([listPage,detailPage])];
  const salaryReaders=new Map(pages.map(page=>[page,observeSalaryFonts(page)]));
  const guards=new Map();
  let sessionBlock=null;
  const stopSession=result=>{
    if(sessionBlock) return;
    sessionBlock=result;
    for(const guard of guards.values()) void guard.stop(result.status);
  };
  for(const page of pages) guards.set(page,await guardNavigation(page,{platform,onBlock:stopSession}));
  const blocked=page=>sessionBlock || guards.get(page)?.result();
  let lastSignature='',search='',observedCards=[];
  const signature=data=>(data.jobs||[]).map(j=>j.url.split('?')[0]).sort().join('|');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const read=async(page,kind,previous='',expected)=>{
    let until=Date.now()+timeoutMs,expanded=false;
    let result={status:'extraction_failed'};
    do {
      if(blocked(page)) return blocked(page);
      if(guards.get(page).pending()) { await pause(100); continue; }
      try { result=await page.evaluate(extractPage,{platform,kind,expected}); }
      catch { if(blocked(page)) return blocked(page); if(page.isClosed()) return {status:'network_error'}; await pause(150); continue; }
      if(blocked(page)) return blocked(page);
      if(guards.get(page).pending()) { await pause(100); continue; }
      result=salaryReaders.get(page).decorate(result);
      if(platform==='linkedin'&&kind==='detail'&&result.status==='jd_truncated'&&!expanded){
        expanded=true;await pause(delayMs);if(blocked(page))return blocked(page);
        await page.evaluate(expandDescription);until=Date.now()+timeoutMs;continue;
      }
      if(result.status==='challenge') { await guards.get(page).stop('challenge'); return result; }
      if(['login_required','closed','empty'].includes(result.status)) return result;
      if(result.status==='ok' && (!previous||signature(result)!==previous)) {
        if(salaryReaders.get(page).pending()) {await pause(100);continue;}
        return result;
      }
      await pause(200);
    }while(Date.now()<until);
    if(guards.get(page).pending()) { await guards.get(page).stop('challenge'); return {status:'challenge'}; }
    return result.status==='ok'&&previous ? {...result,status:'repeated_page'} : result;
  };
  const navigate=async(page,url,kind)=>{
    if(blocked(page)) return blocked(page);
    await pause(delayMs);
    if(blocked(page)) return blocked(page);
    const documentStamp=()=>page.evaluate(()=>performance.timeOrigin).catch(()=>null);
    const initialDocument=await documentStamp();
    let targetNavigationSeen=false,response;
    const committed=frame=>{if(frame===page.mainFrame() && frame.url()===url) targetNavigationSeen=true;};
    page.on('framenavigated',committed);
    try {
      response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:timeoutMs});
    }catch(error) {
      const currentDocument=targetNavigationSeen && !page.isClosed()?await documentStamp():null;
      // framenavigated also fires for replaceState; timeOrigin distinguishes a
      // new document from an old page merely rewriting its URL.
      const documentCommitted=targetNavigationSeen && typeof initialDocument==='number' && typeof currentDocument==='number' && initialDocument!==currentDocument;
      // Never print exception messages: they may contain session-bearing URLs.
      onEvent({event:'navigation_error',platform,kind,documentCommitted,pageClosed:page.isClosed(),errorType:error.name==='TimeoutError'?'timeout':'navigation',code:String(error.message).match(/net::(ERR_[A-Z_]+)/)?.[1] || 'unknown'});
      if(blocked(page)) return blocked(page);
      if(guards.get(page).pending()) return read(page,kind);
      // An interrupted navigation may already have committed its target. Give
      // that live document the normal bounded DOM wait; never reuse an old page.
      if(documentCommitted && !page.isClosed() && page.url()===url) return read(page,kind);
      return {status:'network_error'};
    }finally {page.off('framenavigated',committed);}
    const result=await read(page,kind);
    if(result.status==='extraction_failed' && response && response.status()>=400) return {...result,status:'network_error'};
    return result;
  };
  const next=async()=>{
    if(blocked(listPage)) return blocked(listPage);
    if(platform!=='boss'){
      await pause(delayMs);if(blocked(listPage))return blocked(listPage);
      const control=await listPage.evaluate(nextControl);
      if(!['target','control'].includes(control.status))return control;
      if(control.status==='target'){
        try{validateNextUrl(platform,search,listPage.url(),control.url);}catch{return {status:'pagination_identity_mismatch'};}
        try{await listPage.goto(control.url,{waitUntil:'domcontentloaded',timeout:timeoutMs});}catch{if(blocked(listPage))return blocked(listPage);return {status:'network_error'};}
      }else await listPage.evaluate(nextControl,{click:true});
      const result=await read(listPage,'listing',lastSignature);
      if(result.status==='ok'){
        try{if(searchIdentity(platform,listPage.url())!==searchIdentity(platform,search))return {status:'pagination_identity_mismatch'};}catch{return {status:'pagination_identity_mismatch'};}
        lastSignature=signature(result);observedCards=result.jobs;
      }
      return result;
    }
    const selectors=['.ant-pagination-next','.options-pages .next','.pagination-next','a.next','button.next','[aria-label="下一页"]','[title="下一页"]'];
    for(const selector of selectors) {
      const button=listPage.locator(selector).first();
      if(!await button.isVisible()) continue;
      const cls=await button.getAttribute('class')||'';
      if(/disabled/.test(cls)||await button.getAttribute('aria-disabled')==='true'||!await button.isEnabled()) return {status:'end'};
      await pause(delayMs);
      if(blocked(listPage)) return blocked(listPage);
      try { await button.click({timeout:timeoutMs}); }
      catch(e) { if(blocked(listPage)) return blocked(listPage); throw e; }
      const result=await read(listPage,'listing',lastSignature);
      if(result.status==='ok') lastSignature=signature(result);
      return result;
    }
    // Some BOSS layouts use a scrollable list rather than numbered pagination.
    await pause(delayMs);
    if(blocked(listPage)) return blocked(listPage);
    const scrolled=await listPage.evaluate(()=>{
      const list=document.querySelector('.job-list-container,.job-list-box');
      if(!list) return false;
      let target=list;
      while(target!==document.body && target.scrollHeight<=target.clientHeight+4) target=target.parentElement;
      target.scrollTop=target.scrollHeight;
      if(target===document.body) window.scrollTo(0,document.body.scrollHeight);
      return true;
    });
    if(scrolled) {
      const result=await read(listPage,'listing',lastSignature);
      if(result.status==='ok') { lastSignature=signature(result);return result; }
      if(['challenge','login_required'].includes(result.status)) return result;
    }
    const text=await listPage.locator('body').innerText();
    return {status:/没有更多职位|没有更多了|已显示全部职位/.test(text)?'end':'pagination_unavailable'};
  };

  const bossDetail=async(card,expected)=>{
    if(blocked(listPage)) return blocked(listPage);
    // Only the observed v6729 job-name anchor bubbles to card selection. Never
    // click the card center, where contact/company/favorite controls may sit.
    const anchor=listPage.locator(`.job-card-wrap .job-card-box a.job-name[href="/job_detail/${expected.id}.html"]`);
    let unexpectedNavigation=false;
    const preventNavigation=async route=>{
      const request=route.request();
      if(request.isNavigationRequest() && request.frame()===listPage.mainFrame()
        && !/\/security(?:\.html|\/)|\/captcha(?:\/|$)/.test(new URL(request.url()).pathname)) {
        unexpectedNavigation=true;
        await route.abort();
      }else await route.fallback();
    };
    try {
      const search=validateSearchUrl(platform,listPage.url());
      if(await anchor.count()!==1 || !await anchor.isVisible() || await anchor.getAttribute('target')) return {status:'extraction_failed'};
      const title=(await anchor.innerText()).trim();
      if(!title || (card.title && card.title!==title)) return {status:'extraction_failed'};
      expected={...expected,title};
      if(await anchor.evaluate(a=>a.closest('.job-card-box').classList.contains('is-close'))) return {status:'closed'};
      // A preselected card already has its panel. Validate it without clicking
      // again (BOSS itself ignores a second click on the same job ID).
      const current=await listPage.evaluate(extractPage,{platform,kind:'panel',expected});
      if(current.status==='challenge') { await guards.get(listPage).stop('challenge'); return current; }
      if(current.status==='ok') return read(listPage,'panel','',expected);
      if(current.status==='login_required') return current;
      await pause(delayMs);
      if(blocked(listPage)) return blocked(listPage);
      await listPage.route('**/*',preventNavigation);
      await anchor.click({timeout:timeoutMs});
      const result=await read(listPage,'panel','',expected);
      if(blocked(listPage)) return blocked(listPage);
      if(unexpectedNavigation || listPage.url()!==search) return {status:'extraction_failed'};
      return result;
    }catch {
      return blocked(listPage) || {status:'extraction_failed'};
    }finally {
      if(!listPage.isClosed()) await listPage.unroute('**/*',preventNavigation);
    }
  };
  return {
    async listing(url,pageIndex=0) {
      url=validateSearchUrl(platform,url);
      search=url;
      let result=await navigate(listPage,url,'listing');
      if(result.status==='ok'){
        if(platform!=='boss')try{if(searchIdentity(platform,listPage.url())!==searchIdentity(platform,search))return {status:'identity_mismatch'};}catch{return {status:'identity_mismatch'};}
        lastSignature=signature(result);observedCards=result.jobs;
      }
      for(let page=0;page<pageIndex && result.status==='ok';page++) result=await next();
      return result;
    },
    async detail(card) {
      const expected=jobIdentity(platform,card.url);
      if(platform==='boss') {
        const result=await bossDetail(card,expected);
        return result.status==='ok'?{...result,job:{...result.job,url:expected.url}}:result.status==='closed'?{...result,boundUrl:expected.url}:result;
      }
      if(!observedCards.some(c=>{try{return jobIdentity(platform,c.url).key===expected.key&&c.title===card.title;}catch{return false;}}))return {status:'identity_mismatch'};
      const result=await navigate(detailPage,card.url,'detail');
      if(['ok','closed'].includes(result.status)) {
        try { if(jobIdentity(platform,detailPage.url()).key!==expected.key) return {status:'extraction_failed'}; }
        catch {return {status:'extraction_failed'};}
      }
      return result.status==='ok'?{...result,job:{...result.job,url:expected.url}}:result.status==='closed'?{...result,boundUrl:expected.url}:result;
    },
    next,
    async close() {
      if(owned) await context.close();
      else for(const page of pages) await page.close();
    },
  };
}
