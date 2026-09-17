import test from 'node:test';import assert from 'node:assert/strict';
import {drainSearch,pendingSearchGroups} from '../../china/continuous-collection.mjs';

test('resume skips genuine ends but retains interrupted and shallow-repeat searches',()=>{
 const groups=['end','empty','crash','capped','shallow','not-started'].map(groupKey=>({groupKey}));
 const history=[
  {groupKey:'end',status:'exhausted',reason:'end'},
  {groupKey:'empty',status:'exhausted',reason:'empty'},
  {groupKey:'crash',status:'blocked',reason:'browser_closed'},
  {groupKey:'capped',status:'blocked',reason:'repeated_page',pageIndex:19},
  {groupKey:'shallow',status:'blocked',reason:'repeated_page',pageIndex:1},
 ];
 assert.deepEqual(pendingSearchGroups(groups,history).map(g=>g.groupKey),['crash','shallow','not-started']);
});
function fixture({count=12,failure=false,repeat=false}={}){let left=count,calls=0,acks=0,next=0;return {stats:()=>({left,calls,acks,next}),options:{driver:{listing:async()=>({status:'ok',jobs:[{url:'one'}]}),next:async()=>{next++;return repeat?{status:'ok',jobs:[{url:'one'}]}:{status:'end'};}},plan:async()=>({records:Array.from({length:left},(_,i)=>({key:String(i)}))}),batch:async()=>{calls++;const n=Math.min(5,left);left-=n;return{status:failure?'partial':'limited',reason:failure?'challenge':'job_limit',completed:n,captured:n};},afterBatch:async()=>{acks++;},checkpoint:async()=>{},searchUrl:'url'}};}
test('drains more than five and waits for analysis before next batch, then advances',async()=>{const f=fixture();const r=await drainSearch(f.options);assert.equal(r.status,'exhausted');assert.deepEqual(f.stats(),{left:0,calls:3,acks:3,next:1});});
test('failure preserves captured batch analysis and stops without another navigation',async()=>{const f=fixture({failure:true});const r=await drainSearch(f.options);assert.equal(r.status,'blocked');assert.deepEqual(f.stats(),{left:7,calls:1,acks:1,next:0});});
test('repeated next page does not loop',async()=>{const f=fixture({count:0,repeat:true});assert.equal((await drainSearch(f.options)).reason,'repeated_page');assert.equal(f.stats().next,1);});
test('zero progress with approved records stops instead of retrying',async()=>{const f=fixture();f.options.batch=async()=>({status:'limited',captured:0,completed:0});assert.equal((await drainSearch(f.options)).reason,'no_progress');});
test('failed analysis prevents further collection',async()=>{const f=fixture();f.options.afterBatch=async()=>{throw Error('analysis failed');};await assert.rejects(drainSearch(f.options),/analysis failed/);assert.equal(f.stats().calls,1);});

test('a search that reached a terminal boundary reports approved cards that never appeared',async()=>{
 const {terminalMissingReviews}=await import('../../china/continuous-collection.mjs');
 const group={keys:['liepin:seen','liepin:gone','liepin:closed','liepin:gap'],listingVersions:{'liepin:seen':'v1','liepin:gone':'v2','liepin:closed':'v3','liepin:gap':'v4'}};
 const state={jobs:{'liepin:seen':{latest:{hash:'h'}},'liepin:closed':{lastAttempt:{status:'closed'}},'liepin:gap':{lastAttempt:{status:'source_insufficient'}}}};
 const reviews=terminalMissingReviews({group,state,policyDigest:'p',checkedAt:'2026-09-16T00:00:00Z'});
 assert.deepEqual(reviews.map(r=>r.key),['liepin:gone']);
 assert.equal(reviews[0].status,'source_not_on_current_page');assert.equal(reviews[0].listingVersion,'v2');
 assert.equal(reviews[0].policyDigest,'p');assert.equal(reviews[0].checkedAt,'2026-09-16T00:00:00Z');
});

test('a search whose pagination kept stalling is held for recovery, never called missing',async()=>{
 const {stalledSearchReviews}=await import('../../china/continuous-collection.mjs');
 const group={keys:['boss:unreached'],listingVersions:{'boss:unreached':'v1'}};
 const state={jobs:{}};
 const retries=[{reason:'repeated_page',pageIndex:1},{reason:'repeated_page',pageIndex:1},{reason:'repeated_page',pageIndex:1}];
 const reviews=stalledSearchReviews({group,state,policyDigest:'p',checkedAt:'2026-09-16T00:00:00Z',attempts:retries.length});
 assert.equal(reviews.length,1);
 assert.equal(reviews[0].status,'extraction_failed');
 assert.equal(reviews[0].reason,'pagination_stalled');
 assert.equal(reviews[0].key,'boss:unreached');
 assert.deepEqual(stalledSearchReviews({group,state,policyDigest:'p',attempts:1}),[]);
});
