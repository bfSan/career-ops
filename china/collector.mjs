import {loadMarketDefaults} from './market-defaults.mjs';
import {loadListingScreen} from './listing-screen.mjs';
import {listingVersion} from './market-workflow.mjs';
import { randomUUID } from 'node:crypto';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { validateSearchUrl, jobIdentity, buildObservationFacts } from './platforms.mjs';
import { openStore, saveStore, storePath, recordObservation, fingerprint } from './store.mjs';

export async function collect({root,platform,searchUrl,limit=20,maxPages=1,resume=false,skipArchived=false,marketPlan=null,driver,onProgress=()=>{}}) {
  searchUrl=validateSearchUrl(platform,searchUrl);
  const screen=loadListingScreen(root);
  if(marketPlan&&(!screen||marketPlan.policyDigest!==screen.policyDigest||!Array.isArray(marketPlan.records)))throw new Error('market plan policy missing or changed');
  const approved=marketPlan?new Set(marketPlan.records.filter(r=>r.state==='ready').map(r=>JSON.stringify([r.key,r.listingVersion]))):null;
  const planDigest=marketPlan?fingerprint(marketPlan):null;
  if(!Number.isInteger(limit)||limit<1||limit>500) throw new Error('limit must be 1–500');
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>20) throw new Error('pages must be 1–20');
  return withPipelineLock(storePath(root),async()=>{
    const state=openStore(root);
    const queryKey=fingerprint({platform,searchUrl});
    let run=resume ? [...state.runs].reverse().find(r=>r.queryKey===queryKey && r.status!=='exhausted') : null;
    if(resume && !run) throw new Error('No resumable run for this exact search; start without --resume');
    if(!run) {
      run={id:randomUUID(),queryKey,platform,searchUrl,startedAt:new Date().toISOString(),status:'running',reason:null,pageIndex:0,pageDone:false,pending:[],seen:[],pageSignatures:[],completed:0,captured:0,closed:0};
      state.runs.push(run);
    }
    if(resume&&(run.screeningPolicyDigest||null)!==(screen?.policyDigest||null))throw new Error('Collection policy changed; start a new run rather than resuming old screening decisions');
    if(resume&&(run.marketPlanDigest||null)!==planDigest)throw new Error('market plan changed; start a new run');
    if(planDigest)run.marketPlanDigest=planDigest;
    if(screen)run.screeningPolicyDigest=screen.policyDigest;
    run.status='running';run.reason=null;
    const save=()=>{run.updatedAt=new Date().toISOString();if(driver.requestLog?.().length)run.requests=driver.requestLog();saveStore(root,state);};
    const screenPending=()=>{
      if(!screen)return;
      const decisions=run.pending.map(card=>{
        const decision=screen(card);
        const previous=state.jobs[card.key]?.lastAttempt;
        if(skipArchived&&previous?.status==='source_insufficient'&&previous.source?.listingVersion===listingVersion(card)&&previous.source?.policyDigest===screen.policyDigest)Object.assign(decision,{outcome:'review',rule:'held_source_gap'});
        if(approved&&decision.outcome==='collect'&&!approved.has(JSON.stringify([card.key,listingVersion(card)])))Object.assign(decision,{outcome:'review',rule:'not_approved_or_listing_changed'});
        return{key:card.key,pageIndex:run.pageIndex,card:structuredClone(card),...decision};
      });
      const keys=new Set(decisions.map(d=>d.key));
      run.screened=[...(run.screened||[]).filter(d=>!keys.has(d.key)),...decisions];
      const allowed=new Set(decisions.filter(d=>d.outcome==='collect').map(d=>d.key));
      run.pending=run.pending.filter(c=>allowed.has(c.key));
      run.pageDone=run.pending.length===0;
      save();
    };
    const finish=(status,reason)=>{
      run.status=status;run.reason=reason;save();
      return {id:run.id,platform,status,reason,completed:run.completed,captured:run.captured,closed:run.closed,pending:run.pending.length,sourceGaps:run.sourceGaps||[],...(marketPlan?{followupTasks:run.followupTasks||[]}:{}),...(screen?{screening:{policyDigest:screen.policyDigest,collect:(run.screened||[]).filter(s=>s.outcome==='collect').length,excluded:(run.screened||[]).filter(s=>s.outcome==='exclude').length,needsReview:(run.screened||[]).filter(s=>s.outcome==='review').length}}:{}),page:run.pageIndex+1,storePath:storePath(root)};
    };
    const stopped=status=>finish(['challenge','login_required','browser_permission_required','automation_permission_required','browser_profile_in_use'].includes(status)?'blocked':'partial',status);
    const read=async fn=>{try{return await fn();}catch{return {status:'network_error'};}};
    save();
    let page=await read(()=>driver.listing(searchUrl,run.pageIndex));
    let count=0,pages=0;
    const completedCheckpoint=resume && !run.pending.length && !run.pageDone && run.pageSignatures.length>run.pageIndex;
    if(resume && (run.pending.length || run.pageDone || completedCheckpoint)) {
      if(page.status==='empty') return finish('partial','resume_page_changed');
      if(page.status!=='ok') return stopped(page.status);
      const keys=new Set();
      for(const card of page.jobs || []) {
        try {keys.add(jobIdentity(platform,card.url).key);} catch { /* ignore invalid links */ }
      }
      if(fingerprint([...keys].sort())!==run.pageSignatures.at(-1)) return finish('partial','resume_page_changed');
      if(completedCheckpoint) {
        if(![...keys].every(key=>run.seen.includes(key)||(run.screened||[]).some(s=>s.key===key&&s.outcome!=='collect'))) return finish('partial','invalid_checkpoint');
        run.pageDone=true;save();
      }
      if(screen){
        // Identity equality does not imply unchanged title/location evidence.
        // Reconsider every unread card, including previously withheld cards.
        const fresh=new Map();
        for(const card of page.jobs||[]){try{const key=jobIdentity(platform,card.url).key;fresh.set(key,{...card,key});}catch{}}
        run.pending=[...fresh.values()].filter(card=>!run.seen.includes(card.key));
        screenPending();
      }
    }
    // A resumed, fully consumed page is restored only to locate its next button.
    if(run.pageDone) {
      if(page.status!=='ok') return page.status==='empty'?finish('partial','resume_page_changed'):stopped(page.status);
      page=await read(()=>driver.next());
      if(page.status==='end') return finish('exhausted','end_of_results');
      if(page.status!=='ok') return stopped(page.status);
      run.pageIndex++;run.pageDone=false;
    }
    while(true) {
      if(page.status==='empty') return finish('exhausted','empty_results');
      if(page.status!=='ok') return stopped(page.status);
      pages++;
      if(!run.pending.length) {
        const unique=new Map();
        for(const card of page.jobs || []) {
          try { const id=jobIdentity(platform,card.url);unique.set(id.key,{...card,key:id.key}); } catch { /* invalid external link is never navigated */ }
        }
        if(!unique.size) return finish('partial','no_valid_cards');
        const signature=fingerprint([...unique.keys()].sort());
        if(run.pageSignatures.includes(signature)) return finish('partial','repeated_page');
        run.pageSignatures.push(signature);
        run.pending=[...unique.values()].filter(c=>!run.seen.includes(c.key));
        run.cardPages||={};
        for(const key of unique.keys())run.cardPages[key]=run.pageIndex;
        run.observedSearchUrl=page.url || searchUrl;
        save(); // Preserve the full page before the first detail navigation.
      }
      screenPending();
      while(run.pending.length) {
        if(skipArchived&&state.jobs[run.pending[0].key]?.latest){
          const card=run.pending.shift();run.seen.push(card.key);
          run.skippedArchived=[...new Set([...(run.skippedArchived||[]),card.key])];
          run.pageDone=run.pending.length===0;save();continue;
        }
        if(count>=limit) return finish('limited','job_limit');
        const card=run.pending[0];
        const detail=await read(()=>driver.detail(card));
        const fields=Object.fromEntries(Object.entries(detail.job || {}).filter(([,value])=>value!=='' && value!==null && value!==undefined));
        // Empty detail arrays must not discard useful list-side tags/quality flags.
        fields.tags=[...new Set([...(card.tags||[]),...(fields.tags||[])])];
        fields.qualityFlags=[...new Set([...(card.qualityFlags||[]),...(fields.qualityFlags||[])])];
        fields.advertised=card.advertised===true || fields.advertised===true;
        const captured={...card,...fields};
        if(fields.salaryRaw) {
          for(const key of ['salaryText','salaryEvidence']) {
            if(!Object.hasOwn(fields,key)) delete captured[key];
          }
        }
        const observedAt=new Date().toISOString();
        const facts=detail.status==='ok'?buildObservationFacts(captured,observedAt,loadMarketDefaults(root).providers?.[platform]):null;
        const observed=recordObservation(root,state,{...captured,platform,url:card.url,observedAt,...(facts?{facts}:{}),...(detail.status==='source_insufficient'?{source:{reason:detail.reason||'short_description',description:fields.description||'',listingVersion:listingVersion(card),policyDigest:screen?.policyDigest||null}}:{}),status:detail.status==='ok'?'ok':['closed','login_required','challenge','network_error','source_insufficient'].includes(detail.status)?detail.status:'extraction_failed'});
        const status=observed.observations.at(-1).status;
        if(marketPlan&&status==='ok'){
          const task={jobKey:card.key,contentHash:observed.latest.hash,capturePath:observed.latest.capturePath,state:'pending_scope_review'};
          run.followupTasks=[...(run.followupTasks||[]).filter(t=>t.jobKey!==card.key),task];
        }
        save();
        onProgress({key:card.key,status,completed:run.completed});
        if(status==='source_insufficient'){run.sourceGaps=[...(run.sourceGaps||[]),{jobKey:card.key,...observed.lastAttempt.source,checkedAt:observedAt}];run.pending.shift();run.seen.push(card.key);run.completed++;count++;run.pageDone=run.pending.length===0;save();continue;}
        if(!['ok','closed'].includes(status)) return stopped(detail.status==='ok'?status:detail.status);
        run.pending.shift();run.seen.push(card.key);run.completed++;count++;
        if(status==='ok') run.captured++; else run.closed++;
        run.pageDone=run.pending.length===0;
        save();
      }
      run.pageDone=true;save();
      if(count>=limit) return finish('limited','job_limit');
      if(pages>=maxPages) return finish('limited','page_limit');
      page=await read(()=>driver.next());
      if(page.status==='end') return finish('exhausted','end_of_results');
      if(page.status==='ok') {run.pageIndex++;run.pageDone=false;save();}
    }
  });
}
