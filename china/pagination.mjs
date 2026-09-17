import {validateSearchUrl} from './platforms.mjs';

// Serialized into the owned tab. Only explicitly labelled pagination controls.
export function nextControl({click=false}={}) {
 const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 for(const selector of ['.ant-pagination-next','.options-pages .next','.pagination-next','a.next','button.next','a[rel="next"]','button[aria-label="Next"]','button[aria-label="View next page"]','[aria-label="下一页"]','[title="下一页"]']){
  const el=[...document.querySelectorAll(selector)].find(visible);if(!el)continue;
  if(el.disabled||/disabled/.test(el.className)||el.getAttribute('aria-disabled')==='true')return {status:'end'};
  const target=el.matches('a,button')?el:el.querySelector('a,button')||el;
  if(target.disabled||target.getAttribute('aria-disabled')==='true')return {status:'end'};
  const href=target.getAttribute('href');
  if(href&&!['#','javascript:;','javascript:void(0)'].includes(href))return {status:'target',url:new URL(href,location.href).href};
  if(click)target.click();return {status:'control'};
 }
 return {status:/没有更多职位|没有更多了|已显示全部职位|No more jobs/i.test(document.body?.innerText||'')?'end':'pagination_unavailable'};
}

const pageKeys=platform=>platform==='liepin'?['currentPage','curPage','page']:['start','pageNum'];
function normalizedSearch(platform,value) {
 const u=new URL(validateSearchUrl(platform,value));
 if(platform==='liepin'){
  // Observed search-page transport metadata; nonempty filters remain significant.
  for(const k of ['ckId','skId','fkId','scene','sfrom'])u.searchParams.delete(k);
  for(const k of ['pubTime','suggestTag','workYearCode','compId','compName','compTag','industry','salaryCode','jobKind','compScale','compKind','compStage','eduLevel','suggestId']){
   if(u.searchParams.getAll(k).every(v=>v===''))u.searchParams.delete(k);
  }
  if(u.searchParams.getAll('pageSize').length===1&&u.searchParams.get('pageSize')==='40')u.searchParams.delete('pageSize');
 }
 return u;
}
export function searchIdentity(platform,value) {
 const u=normalizedSearch(platform,value);
 for(const k of pageKeys(platform))u.searchParams.delete(k);
 u.searchParams.sort();return u.href;
}
export function searchPageIdentity(platform,value) {
 const u=normalizedSearch(platform,value);
 // An omitted zero-based page offset is the initial page, not an unknown page.
 for(const k of platform==='liepin'?['currentPage','curPage']:['start']){
  if(u.searchParams.getAll(k).length===1&&u.searchParams.get(k)==='0')u.searchParams.delete(k);
 }
 u.searchParams.sort();return u.href;
}
export function validateNextUrl(platform,search,current,target) {
 if(searchIdentity(platform,target)!==searchIdentity(platform,search))throw new Error('pagination_identity_mismatch');
 const next=new URL(target),old=new URL(current),keys=pageKeys(platform);
 const changed=keys.filter(k=>next.searchParams.get(k)!==old.searchParams.get(k));
 if(changed.length!==1||!/^\d+$/.test(next.searchParams.get(changed[0])||'')||Number(next.searchParams.get(changed[0]))<=Number(old.searchParams.get(changed[0])||0))throw new Error('pagination_identity_mismatch');
 return next.href;
}
