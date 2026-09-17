// Orchestrates bounded collector batches; analysis must acknowledge each batch.
// Provider drivers retain their own delays, identity checks and stop conditions.
export function pendingSearchGroups(groups,history){
 const done=new Set(history.filter(g=>isTerminalSearch(g)).map(g=>g.groupKey));
 // A shallow repeat means pagination stalled: worth retrying, but bounded so a
 // query that keeps stalling cannot re-run on every round forever.
 const stalls={};
 for(const g of history)if(g?.reason==='repeated_page'&&Number(g.pageIndex)<PAGE_CAP_REPEAT)stalls[g.groupKey]=(stalls[g.groupKey]||0)+1;
 return groups.filter(g=>!done.has(g.groupKey)&&(stalls[g.groupKey]||0)<MAX_SHALLOW_RETRIES);
}
// A search that reached a terminal boundary will never surface its approved
// cards again. Without this, approved-but-never-listed cards stay "ready"
// forever, and every later round re-walks the same drained search for nothing.
const COMPLETE_ATTEMPT = new Set(['source_insufficient', 'closed']);
// Only a genuine end-of-results proves a card left the source list. A repeat at
// a shallow page means the pagination control failed, not that the job is
// gone; the platform's own page cap is the practical end of what it will serve.
const END_OF_RESULTS = new Set(['end', 'empty', 'end_of_results', 'empty_results', 'approved_complete']);
export const PAGE_CAP_REPEAT = 19;
export const MAX_SHALLOW_RETRIES = 3;
export const isTerminalSearch = group =>
 END_OF_RESULTS.has(group?.reason) || (group?.reason === 'repeated_page' && Number(group?.pageIndex) >= PAGE_CAP_REPEAT);
export function terminalMissingReviews({group, state, policyDigest, checkedAt}) {
 const jobs = state?.jobs || {};
 const raw = group?.listingVersions || {};
 const versions = raw instanceof Map ? {get:k=>raw.get(k)} : {get:k=>raw[k]};
 return [...(group?.keys || [])].flatMap(key => {
  const job = jobs[key];
  if (job?.latest) return [];
  if (COMPLETE_ATTEMPT.has(job?.lastAttempt?.status)) return [];
  const listingVersion_ = versions.get(key);
  if (!key || !listingVersion_ || !policyDigest) return [];
  return [{
   key, listingVersion: listingVersion_, policyDigest,
   status: 'source_not_on_current_page',
   checkedAt: checkedAt || new Date().toISOString(),
   reason: 'search_reached_end_without_card',
  }];
 });
}

// Once the bounded retries for a stalling search are used up the group stops
// being re-queued, so its unreached cards would sit in "ready" forever. Record
// them as a read failure awaiting recovery. That is a different claim from
// terminalMissingReviews: pagination stalled, so we do not know the card is gone.
export function stalledSearchReviews({group, state, policyDigest, checkedAt, attempts}) {
 if (Number(attempts) < MAX_SHALLOW_RETRIES) return [];
 const jobs = state?.jobs || {};
 const raw = group?.listingVersions || {};
 const versions = raw instanceof Map ? {get:k=>raw.get(k)} : {get:k=>raw[k]};
 return [...(group?.keys || [])].flatMap(key => {
  const job = jobs[key];
  if (job?.latest) return [];
  if (COMPLETE_ATTEMPT.has(job?.lastAttempt?.status)) return [];
  const listingVersion_ = versions.get(key);
  if (!key || !listingVersion_ || !policyDigest) return [];
  return [{
   key, listingVersion: listingVersion_, policyDigest,
   status: 'extraction_failed',
   checkedAt: checkedAt || new Date().toISOString(),
   reason: 'pagination_stalled',
   requiredEvidence: '翻页控件恢复后重新读取同一岗位列表；页面只加载出首页时不得判定岗位已下架',
  }];
 });
}

export async function drainSearch({driver,searchUrl,plan,batch,afterBatch,checkpoint}){
 let page=await driver.listing(searchUrl),pageIndex=0,batches=0,captured=0;
 const visited=new Set();
 const finish=async(status,reason)=>{const result={status,reason,pageIndex,batches,captured};await checkpoint(result);return result;};
 while(true){
  if(['empty','end'].includes(page.status))return finish('exhausted',page.status);
  if(page.status!=='ok')return finish('blocked',page.status);
  const signature=JSON.stringify([...new Set((page.jobs||[]).map(c=>c.key||c.url))].sort());
  if(visited.has(signature))return finish('blocked','repeated_page');
  visited.add(signature);
  await checkpoint({status:'reading',pageIndex,batches,captured,page});
  while(true){
   const approved=await plan(page,pageIndex);
   if(!approved.records.length)break;
   const result=await batch(page,approved,pageIndex);
   batches++;captured+=result.captured||0;
   await checkpoint({status:'awaiting_analysis',pageIndex,batches,captured,result});
   await afterBatch(result);
   if(!['limited','exhausted'].includes(result.status))return finish('blocked',result.reason||result.status);
   if(!(result.completed>0))return finish('blocked','no_progress');
  }
  await checkpoint({status:'page_drained',pageIndex,batches,captured});
  page=await driver.next();pageIndex++;
 }
}
