import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketSelection,listingVersion,reconcileCandidates,analysisTasks,closedReviews} from '../../china/market-workflow.mjs';
const row=(key='boss:one',hash='v1',eligible=true)=>({jobKey:key,contentHash:hash,eligibility:{value:eligible?'eligible':'excluded',scopeReview:'reviewed',evidence:[{field:'description',start:0,end:2,quote:'AI'}]},sourceRef:{jobKey:key,contentHash:hash},location:{targetCities:['上海'],evidence:[{field:'location',start:0,end:2,quote:'上海'}]}});
const pool={configurationHash:'policy-1',records:[row(),row('boss:no','v1',false)]};
test('market selection excludes out-of-scope, unreviewed and changed versions and rejects wrong policy',()=>{
 const selected=marketSelection(pool,'policy-1');assert.equal(selected.has('boss:one','v1'),true);assert.equal(selected.has('boss:no','v1'),false);assert.equal(selected.has('boss:one','v2'),false);
 assert.throws(()=>marketSelection(pool,'policy-2'),/configuration/);
 assert.throws(()=>marketSelection({...pool,records:[row(),row()]},'policy-1'),/duplicate/);
 assert.equal(marketSelection({...pool,records:[{...row(),eligibility:{value:'eligible'}}]},'policy-1').has('boss:one','v1'),false);
});
test('checked missing card stays held across rebuild and font URLs; new job facts require new review',()=>{
 const card={key:'boss:one',title:'AI开发',company:'企业',location:'上海',listingText:'AI开发 上海',salaryFontUrls:['old']};
 const review={key:card.key,listingVersion:listingVersion(card),policyDigest:'p1',status:'not_on_current_page',checkedAt:'2026-09-14T01:00:00Z'};
 const reconcile=(c,p='p1')=>reconcileCandidates({candidates:[{key:c.key,card:c}],reviews:[review],policyDigest:p,screen:()=>({outcome:'review'}),archivedKeys:[]}).records[0];
 assert.equal(reconcile({...card,salaryFontUrls:['new']}).state,'held_not_found');assert.equal(reconcile({...card,title:'AI研究'}).state,'needs_review');assert.equal(reconcile(card,'p2').state,'needs_review');
});
test('analysis tasks survive browser login failures and only same-version complete evidence is reusable',()=>{
 const records=[row()],done=[{jobKey:'boss:one',contentHash:'v1',configurationHash:'policy-1',status:'analyzed'}];
 assert.equal(analysisTasks({pool:{...pool,records},completed:[],collectionStatus:'login_required'})[0].state,'pending_analysis');
 assert.equal(analysisTasks({pool:{...pool,records},completed:done})[0].state,'analyzed');
 assert.equal(analysisTasks({pool:{...pool,records:[row('boss:one','v2')]},completed:done})[0].state,'pending_analysis');
 assert.equal(analysisTasks({pool:{...pool,configurationHash:'policy-2',records},completed:done})[0].state,'pending_analysis');
});
test('provider status names and explicit recheck retain terminal review decisions',()=>{
 const card={key:'boss:one',title:'AI工程师',location:'上海'},review={key:card.key,listingVersion:listingVersion(card),policyDigest:'p',status:'source_not_on_current_page',checkedAt:'2026-09-14T00:00:00Z'};
 const build=(reviews,refreshKeys=[])=>reconcileCandidates({candidates:[{key:card.key,card}],reviews,policyDigest:'p',screen:()=>({outcome:'collect'}),refreshKeys});
 assert.equal(build([review]).records[0].state,'held_not_found');assert.equal(build([review],[card.key]).records[0].state,'ready');
 assert.equal(build([{...review,status:'login_required'}]).records[0].state,'blocked');
 assert.equal(build([{...review,status:'excluded_not_ai'}]).records[0].state,'excluded');
});
test('recruiter online age is not a job version change, but a posting-date change is',()=>{
 const base={key:'liepin:one',title:'解决方案经理',listingText:'解决方案经理\nAI系统交付\n1天前在线'};
 assert.equal(listingVersion(base),listingVersion({...base,listingText:base.listingText.replace('1天前在线','4小时前在线')}));
 assert.notEqual(listingVersion(base),listingVersion({...base,listingText:'解决方案经理\n纯销售\n4小时前在线'}));
 assert.notEqual(listingVersion({...base,listingText:'2天前发布'}),listingVersion({...base,listingText:'1天前发布'}));
});
test('historical Liepin cards recover a separate visible location block, never company HQ or title badges',async()=>{
 const {normalizeListingCard}=await import('../../china/platforms.mjs');
 const card={key:'liepin:a-1',title:'大模型算法',company:'北京某公司',location:'',listingText:'大模型算法\n【\n杭州-余杭区\n】\n30-50k\n北京某公司'};
 assert.equal(normalizeListingCard(card).location,'杭州-余杭区');assert.equal(card.location,'');
 assert.equal(normalizeListingCard({...card,listingText:'【杭州人才补贴】大模型算法\n北京某公司'}).location,'');
 assert.equal(normalizeListingCard({...card,listingText:'大模型算法\n【\n杭州\n】\n【\n北京\n】'}).location,'');
 assert.equal(normalizeListingCard({...card,key:'boss:one'}).location,'');
});
test('reviewed ambiguous scope is held until new job facts arrive',()=>{
 const card={key:'liepin:one',title:'解决方案经理',location:'南京'},r={key:card.key,listingVersion:listingVersion(card),policyDigest:'p',status:'reviewed_scope_unresolved',checkedAt:'2026-09-15T00:00:00Z'};
 const run=c=>reconcileCandidates({candidates:[{key:c.key,card:c}],reviews:[r],policyDigest:'p',screen:()=>({outcome:'review'})}).records[0];
 assert.equal(run(card).state,'held_scope_ambiguity');assert.equal(run({...card,title:'AI算法工程师'}).state,'needs_review');
});
test('review chronology uses instants, not timezone string ordering',()=>{
 const card={key:'boss:one',title:'AI开发',location:'上海'},base={key:card.key,listingVersion:listingVersion(card),policyDigest:'p'};
 const w=reconcileCandidates({candidates:[{key:card.key,card}],policyDigest:'p',screen:()=>({outcome:'collect'}),reviews:[{...base,status:'retry_requested',checkedAt:'2026-09-15T10:00:00+08:00'},{...base,status:'login_required',checkedAt:'2026-09-15T03:00:00Z'}]});
 assert.equal(w.records[0].state,'blocked');
});
test('duplicate or malformed candidate and review inputs fail before creating a collection queue',()=>{
 const card={key:'boss:one',title:'AI开发',location:'上海'},c={key:card.key,card},args={candidates:[c],policyDigest:'p',screen:()=>({outcome:'collect'})};
 assert.throws(()=>reconcileCandidates({...args,candidates:[c,c]}),/duplicate/);
 assert.throws(()=>reconcileCandidates({...args,candidates:[{...c,card:{...card,key:'boss:other'}}]}),/identity/);
 for(const review of [{status:'typo',checkedAt:'2026-09-15T00:00:00Z'},{status:'login_required',checkedAt:'invalid'}])assert.throws(()=>reconcileCandidates({...args,reviews:[{key:c.key,listingVersion:listingVersion(card),policyDigest:'p',...review}]}),/review/);
});

test('persisted short-source evidence holds only the matching listing/policy version',async()=>{
  const {sourceGapReviews}=await import('../../china/market-workflow.mjs');
  const key='liepin:job-1',card={key,title:'AI工程师',location:'南京'},policyDigest='p',version=listingVersion(card),checkedAt='2026-09-15T12:00:00Z';
  const reviews=sourceGapReviews({jobs:{[key]:{lastAttempt:{status:'source_insufficient',at:checkedAt,source:{listingVersion:version,policyDigest,description:'短正文',reason:'short_description'}}}}});
  const screen=()=>({outcome:'collect'}),candidate={key,card};
  assert.equal(reconcileCandidates({candidates:[candidate],reviews,policyDigest,screen}).records[0].state,'held_source_gap');
  assert.equal(reconcileCandidates({candidates:[{key,card:{...card,title:'AI研究工程师'}}],reviews,policyDigest,screen}).records[0].state,'ready');
  assert.equal(reconcileCandidates({candidates:[candidate],reviews,policyDigest:'new',screen}).records[0].state,'ready');
});

test('a withdrawn posting reaches a terminal state instead of staying collectable',()=>{
  // Without this the dead URL stays "ready" forever and is re-read on every
  // later round, which is exactly the non-converging queue this guards.
  const key='liepin:a-1',card={key,title:'AI工程师',company:'某公司',location:'上海',salaryRaw:'30-50k'};
  const closedAt='2026-09-17T04:00:00Z';
  const store={jobs:{[key]:{lastAttempt:{status:'closed',at:closedAt},latestListing:{title:card.title,company:card.company,location:card.location,salaryRaw:card.salaryRaw}}}};
  const reviews=closedReviews(store,'p');
  assert.equal(reviews.length,1);
  assert.equal(reviews[0].listingVersion,listingVersion(card));
  assert.equal(reviews[0].status,'excluded_closed');
  const screen=()=>({outcome:'collect'}),candidate={key,card};
  const closed=reconcileCandidates({candidates:[candidate],reviews,policyDigest:'p',screen}).records[0];
  assert.equal(closed.state,'excluded');
  // A different visible version is a different question: it must not be closed.
  assert.equal(reconcileCandidates({candidates:[{key,card:{...card,title:'AI研究工程师'}}],reviews,policyDigest:'p',screen}).records[0].state,'ready');
  // A reopened job is captured again, so its newest attempt is not a closure.
  assert.deepEqual(closedReviews({jobs:{[key]:{lastAttempt:{status:'ok',at:closedAt},latest:{hash:'h'},latestListing:{title:card.title}}}}, 'p'),[]);
  // Without a policy digest the review cannot be version-bound, so it is not invented.
  assert.deepEqual(closedReviews(store,null),[]);
  // A closure recorded before the listing facts were stored cannot be bound to a version.
  assert.deepEqual(closedReviews({jobs:{[key]:{lastAttempt:{status:'closed',at:closedAt}}}}, 'p'),[]);
});
