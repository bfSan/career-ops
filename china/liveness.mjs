import {selectBrowserDriver} from './driver-choice.mjs';
import {jobIdentity,validateSearchUrl,buildObservationFacts} from './platforms.mjs';
import {openStore,saveStore,storePath,recordObservation,recordAvailabilityObservation,observationContent,fingerprint} from './store.mjs';
import {withPipelineLock} from '../pipeline-lock.mjs';

export function classifyDomesticResult(url,platform,result) {
  const checkedAt=new Date().toISOString(),status=result?.status||'extraction_failed';
  const base={result:'uncertain',reason:status,checkedAt};
  if(!['closed','ok'].includes(status))return base;
  try {
    if(jobIdentity(platform,status==='closed'?result.boundUrl:result.job?.url).key!==jobIdentity(platform,url).key)return {...base,reason:'identity_mismatch'};
  }catch{return {...base,reason:'identity_mismatch'};}
  if(status==='closed')return result.evidence?.quote?{...base,result:'expired'}:{...base,reason:'closed_evidence_missing'};
  if(!result.job?.title?.trim()||typeof result.job.description!=='string'||result.job.description.trim().length<40)return {...base,reason:'incomplete_jd'};
  const control=result.job.openEvidence;
  const allowed=platform==='boss'?/^(立即沟通|继续沟通)$/:/^(立即沟通|立即投递|投递简历|申请职位|应聘职位|投简历|聊一聊)$/;
  if(control?.field!=='visibleControl'||!allowed.test(control.quote))return {...base,reason:'open_evidence_missing'};
  return {...base,result:'active',reason:'matched_full_jd_with_open_control'};
}

// Reuse an owned query session; bounded page restoration never implies absence = closed.
export function createDomesticChecker({dataRoot,platform,driverFactory,maxJobs=5,maxPages=5,delayMs=15000,sleepImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  if(!['boss','liepin'].includes(platform)||!dataRoot)throw new Error('domestic checker needs platform and dataRoot');
  if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>5||!Number.isFinite(delayMs)||delayMs<15000)throw new Error('domestic budget: 1–5 jobs and delay >=15000ms');
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>5)throw new Error('domestic page budget: 1–5 pages');
  let driver,page,used=0,pagesUsed=0,currentSearch='',currentPage=0,stopped,closed=false,chain=Promise.resolve();
  const uncertain=reason=>({result:'uncertain',reason,checkedAt:new Date().toISOString()});
  async function close(){if(closed)return;closed=true;if(driver)await driver.close();}
  async function persist(url,result,raw,card) {
    await withPipelineLock(storePath(dataRoot),async()=>{
      const state=openStore(dataRoot),identity=jobIdentity(platform,url),job=state.jobs[identity.key];
      if(!job)return;
      if(result.result==='active'){
        const fields=Object.fromEntries(Object.entries(raw.job).filter(([,v])=>v!==''&&v!==null&&v!==undefined));
        const input={...card,...fields,platform,url,status:'ok',observedAt:result.checkedAt};
        input.tags=[...new Set([...(card.tags||[]),...(fields.tags||[])])];
        input.qualityFlags=[...new Set([...(card.qualityFlags||[]),...(fields.qualityFlags||[])])];
        input.advertised=card.advertised===true||fields.advertised===true;
        if(fields.salaryRaw)for(const key of ['salaryText','salaryEvidence'])if(!Object.hasOwn(fields,key))delete input[key];
        if(fingerprint(observationContent(input))!==job.latest?.hash){
          const facts=buildObservationFacts(raw.job,result.checkedAt);
          recordObservation(dataRoot,state,{...input,...(facts?{facts}:{})});
        }
      }
      const proof=raw?.job?.openEvidence||raw?.evidence;
      recordAvailabilityObservation(state,{...result,platform,url,jobKey:identity.key,evidence:proof?[proof]:[]});
      saveStore(dataRoot,state);
    });
  }
  async function checkOne(url){
    if(used>=maxJobs)return uncertain('budget_exhausted');
    if(stopped)return uncertain(stopped);
    if(closed)return uncertain('checker_closed');
    let identity;try{identity=jobIdentity(platform,url);}catch{return uncertain('identity_mismatch');}
    const state=openStore(dataRoot);
    const query=[...state.runs].reverse().find(run=>run.seen?.includes(identity.key));
    let search;try{search=validateSearchUrl(platform,query?.searchUrl);}catch{return uncertain('query_reference_missing');}
    if(!state.jobs[identity.key])return uncertain('query_reference_missing');
    if(used)await sleepImpl(delayMs);
    used++;
    let raw,card,result;
    try{
      const recorded=query.cardPages?.[identity.key];
      const targetPage=Number.isInteger(recorded)&&recorded>=0?recorded:0;
      const restart=driver&&(currentSearch!==search||(recorded!==undefined&&currentPage!==targetPage));
      if((!driver||restart)&&pagesUsed+targetPage+1>maxPages)return uncertain('page_budget_exhausted');
      if(restart){await driver.close();driver=null;}
      if(!driver){
        const factory=driverFactory||(selectBrowserDriver({platform})==='native'?(await import('./native-driver.mjs')).createNativeDriver:(await import('./browser.mjs')).createBrowserDriver);
        driver=await factory({root:dataRoot,platform,delayMs});
        page=await driver.listing(search,targetPage);pagesUsed+=targetPage+1;currentSearch=search;currentPage=targetPage;
      }
      if(page?.status!=='ok')raw={status:page?.status||'extraction_failed'};
      else{
        const find=()=>page.jobs?.find(c=>{try{return jobIdentity(platform,c.url).key===identity.key;}catch{return false;}});
        card=find();
        while(!card&&recorded===undefined&&pagesUsed<maxPages&&driver.next){
          page=await driver.next();pagesUsed++;currentPage++;
          if(page.status!=='ok')break;card=find();
        }
        raw=card?await driver.detail(card):{status:page.status==='ok'?(pagesUsed>=maxPages?'page_budget_exhausted':'not_in_page'):page.status==='end'?'not_in_results':page.status};
      }
      result=classifyDomesticResult(url,platform,raw);
    }catch{result=uncertain('adapter_error');}
    try{await persist(url,result,raw,card);}catch{result=uncertain('persistence_error');}
    if(result.result==='uncertain'){stopped=result.reason;await close();}
    return result;
  }
  return {check(url){const next=chain.then(()=>checkOne(url));chain=next.catch(()=>{});return next;},close};
}
export async function checkDomesticPosting(url,{dataRoot,driverFactory,domesticChecker}={}) {
  if(domesticChecker)return domesticChecker.check(url);
  const platform=new URL(url).hostname.includes('zhipin.com')?'boss':'liepin';
  const checker=createDomesticChecker({dataRoot,platform,driverFactory});
  try{return await checker.check(url);}finally{await checker.close();}
}
