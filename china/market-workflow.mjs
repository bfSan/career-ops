// Provider-neutral market eligibility and durable work-state reconciliation.
// Targeting rules and review decisions live in the user's Data Root.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,20);
const reviewed=r=>r.eligibility?.value==='eligible'&&r.eligibility.scopeReview==='reviewed'&&r.eligibility.evidence?.length>0&&r.location?.targetCities?.length>0&&r.location.evidence?.length>0&&r.sourceRef?.jobKey===r.jobKey&&r.sourceRef.contentHash===r.contentHash;
export function marketSelection(pool,configurationHash){
 if(!configurationHash||pool?.configurationHash!==configurationHash||!Array.isArray(pool.records))throw new Error('market configuration mismatch or invalid pool');
 const records=new Map();for(const r of pool.records){if(!r.jobKey||!r.contentHash||records.has(r.jobKey))throw new Error('invalid or duplicate market identity');records.set(r.jobKey,r);}
 return {configurationHash,has:(key,hash)=>{const r=records.get(key);return !!r&&r.contentHash===hash&&!!reviewed(r);},records:[...records.values()].filter(reviewed)};
}
export function loadMarketSelection(root,file,configurationHash){
 if(!file&&!configurationHash)return null;
 if(!file||!configurationHash)throw new Error('market-pool and configuration-hash must be provided together');
 return marketSelection(JSON.parse(readFileSync(resolve(root,file),'utf8')),configurationHash);
}
// Browser instrumentation/font URLs are not a change to the job's visible facts.
export const listingVersion=card=>digest(Object.fromEntries(['key','title','company','location','listingText','salaryRaw','experience','education'].map(k=>[k,k==='listingText'?
 String(card[k]??'').split(/\r?\n/).filter(line=>!/^\s*(?:刚刚|今天|今日|昨天|昨日|本周|本月|\d+(?:分钟|小时|天|周|月)前)(?:在线|活跃)\s*$/u.test(line)).join('\n'):card[k]??''])));
const reviewStatuses=new Set(['ok','retry_requested','not_on_current_page','source_not_on_current_page','login_required','challenge','network_error','navigation_changed','extraction_failed','source_insufficient','reviewed_scope_unresolved']);
export function reconcileCandidates({candidates,reviews=[],policyDigest,screen,archivedKeys=[],refreshKeys=[]}){
 if(!policyDigest||typeof screen!=='function')throw new Error('market collection requires a screening policy');
 const identities=new Set();
 for(const c of candidates){
  if(!c.key||!c.card||(c.card.key&&c.card.key!==c.key))throw new Error('invalid candidate identity');
  if(identities.has(c.key))throw new Error('duplicate candidate identity');identities.add(c.key);
 }
 const archived=new Set(archivedKeys),refresh=new Set(refreshKeys),history=new Map();
 for(const r of reviews){
  if(!r.key||!r.listingVersion||!r.policyDigest||!Number.isFinite(Date.parse(r.checkedAt))||!(reviewStatuses.has(r.status)||/^excluded(?:_[a-z_]+)?$/.test(r.status||'')))throw new Error('invalid version-bound review');
  const k=JSON.stringify([r.key,r.listingVersion,r.policyDigest]),previous=history.get(k);
  if(previous&&Date.parse(r.checkedAt)===Date.parse(previous.checkedAt)&&r.status!==previous.status)throw new Error('conflicting review timestamps');
  if(!previous||Date.parse(r.checkedAt)>Date.parse(previous.checkedAt))history.set(k,r);
 }
 const records=candidates.filter(c=>!archived.has(c.key)).map(c=>{
  const card={...c.card,key:c.key},version=listingVersion(card),decision=screen(card),review=refresh.has(c.key)?null:history.get(JSON.stringify([c.key,version,policyDigest]));
  let state=decision.outcome==='collect'?'ready':decision.outcome==='exclude'?'excluded':'needs_review';
  if(review){if(review.status.startsWith('excluded'))state='excluded';else if(['not_on_current_page','source_not_on_current_page'].includes(review.status))state='held_not_found';else if(['login_required','challenge','network_error','navigation_changed','extraction_failed'].includes(review.status))state='blocked';else if(review.status==='source_insufficient')state='held_source_gap';else if(review.status==='reviewed_scope_unresolved')state='held_scope_ambiguity';}
  return {...c,...decision,listingVersion:version,policyDigest,state,review:review??null};
 });
 return{schemaVersion:1,policyDigest,records,summary:records.reduce((o,r)=>(o[r.state]=(o[r.state]||0)+1,o),{})};
}
export function analysisTasks({pool,completed=[]}){
 const selection=marketSelection(pool,pool.configurationHash),done=new Set(completed.filter(c=>c.status==='analyzed').map(c=>JSON.stringify([c.jobKey,c.contentHash,c.configurationHash])));
 return selection.records.map(r=>({jobKey:r.jobKey,contentHash:r.contentHash,configurationHash:pool.configurationHash,sourceRef:r.sourceRef,state:done.has(JSON.stringify([r.jobKey,r.contentHash,pool.configurationHash]))?'analyzed':'pending_analysis'}));
}

// Source gaps are version-bound acquisition evidence, never complete JD analysis.
export function sourceGapReviews(state){
 return Object.entries(state.jobs||{}).flatMap(([key,j])=>{const a=j.lastAttempt,s=a?.source;
  return a?.status==='source_insufficient'&&s?.listingVersion&&s.policyDigest?[{key,listingVersion:s.listingVersion,policyDigest:s.policyDigest,status:'source_insufficient',checkedAt:a.at,reason:s.reason||'short_description',evidence:{field:'description',quote:s.description}}]:[];
 });
}

// A withdrawn posting is a terminal fact about one visible listing version.
// Without this a dead URL stays collectable forever: reconcile only knows about
// list-reappearance and read failures, so "closed" had no state to land in and
// every later round re-opened and re-read the same page.
//
// The version has to come from the listing facts captured alongside the
// closure. Deriving it needs the stored listing text, so a closure recorded
// before those facts existed yields nothing rather than a guessed version —
// an unbound review would close whatever the card looks like now.
export function closedReviews(state,policyDigest){
 if(!policyDigest)return [];
 return Object.entries(state.jobs||{}).flatMap(([key,j])=>{
  const a=j.lastAttempt;
  if(a?.status!=='closed'||!Number.isFinite(Date.parse(a.at)))return [];
  const listing=j.latestListing;
  if(!listing?.title)return [];
  return [{key,listingVersion:listingVersion({...listing,key}),policyDigest,status:'excluded_closed',checkedAt:a.at,reason:'平台明确提示该岗位已下架或停止招聘',evidence:{field:'availability',quote:'职位已下架/暂停招聘'},requiredEvidence:'同一岗位重新上架后按新版本重新核实'}];
 });
}
