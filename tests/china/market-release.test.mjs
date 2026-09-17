import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readlinkSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fingerprint} from '../../china/store.mjs';import {DIMENSIONS} from '../../china/market-analysis.mjs';
import {prepareSourceStudy} from '../../china/market-study.mjs';
import {publishMarketRelease,reconcileWorkflow} from '../../china/market-release.mjs';
async function fixture(t){const root=mkdtempSync(join(tmpdir(),'market-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const fields={title:'AI开发',company:'测试公司',location:'上海',salaryRaw:'\uE031-\uE032K',companySizeRaw:'100-499人',description:'负责AI应用研发，使用Python实现模型推理服务，完成测试与上线，并持续优化性能和质量。'};
 const source={jobKey:'boss:test',contentHash:fingerprint(fields),fields:{...fields,listingText:''},capturePath:'jds/china/test.md',observedAt:'2026-09-14T00:00:00Z',latestAttempt:{status:'ok',at:'2026-09-14T00:00:00Z'},listingBinding:'unbound',queryRefs:[],facts:null};
 mkdirSync(join(root,'jds/china'),{recursive:true});writeFileSync(join(root,source.capturePath),'**Job ID:** test\n'+fields.description);
 const study=await prepareSourceStudy(root,{studyId:'release-test',schemaVersion:2,createdAt:source.observedAt,scope:{cities:['上海'],keywords:['AI'],queryUrls:[]},sources:[source]});
 const evidence=(field,quote)=>({field,start:fields[field].indexOf(quote),end:fields[field].indexOf(quote)+quote.length,quote});
 const row={jobKey:source.jobKey,contentHash:source.contentHash,sourceRef:{jobKey:source.jobKey,contentHash:source.contentHash},title:fields.title,company:fields.company,location:{targetCities:['上海'],evidence:[evidence('location','上海')]},eligibility:{value:'eligible',scopeReview:'reviewed',evidence:[evidence('description','负责AI应用研发')]},analysis:{}};
 row.watchlist={label:'重点公司'};const pool={configurationHash:'cfg',dataThrough:'2026-09-14',records:[row]};
 const bundle={schemaVersion:2,studyId:study.manifest.studyId,sourceDigest:study.manifest.sourceDigest,records:[{jobKey:row.jobKey,contentHash:row.contentHash,analysisVersion:'market-v1',analyzedAt:source.observedAt,roleFamily:'application_agent',roleFamilyEvidence:evidence('description','负责AI应用研发'),cityGroup:'上海',cityEvidence:[evidence('location','上海')],companyKey:fields.company,companyEvidence:evidence('company',fields.company),coverage:Object.fromEntries(DIMENSIONS.map(d=>[d,'reviewed'])),requirements:[],conflicts:[]}]};
 return{root,pool,bundle,study,configurationHash:'cfg',releaseId:'test-release',state:{jobs:{},runs:[]},classifications:[]};
}
test('publishing incomplete or wrong-version results cannot move the current report',async t=>{
 const f=await fixture(t),first=await publishMarketRelease(f.root,f),link=join(f.root,'reports/china-market/current');assert.equal(first.stats.requirementsReviewed,1);assert.equal(first.stats.requirementsPending,0);assert.equal(existsSync(join(link,'analysis-tasks.json')),true,JSON.stringify({first,link,target:readlinkSync(link)}));
 const before=readlinkSync(link);f.bundle.records[0].coverage.skill='not_reviewed';await assert.rejects(publishMarketRelease(f.root,f),/incomplete/);assert.equal(readlinkSync(link),before);
 f.bundle.records[0].coverage.skill='reviewed';f.pool.records[0].contentHash='changed';await assert.rejects(publishMarketRelease(f.root,f),/eligibility|version|source/);assert.equal(readlinkSync(link),before);
});
test('publication refuses stale scope quotes even with a reviewed label',async t=>{
 const f=await fixture(t);f.pool.records[0].eligibility.evidence[0].quote='伪造';await assert.rejects(publishMarketRelease(f.root,f),/scope evidence/);assert.equal(existsSync(join(f.root,'reports/china-market/current')),false);
});
test('durable workflow rebuild does not requeue held records and sees new archives as scope tasks',async t=>{
 const f=await fixture(t),card={key:'boss:next',title:'AI开发',location:'上海'},file=join(f.root,'candidates.json');writeFileSync(file,JSON.stringify({records:[{key:card.key,card}]}));
 const {listingVersion}=await import('../../china/market-workflow.mjs');const review={key:card.key,listingVersion:listingVersion(card),policyDigest:'p',status:'source_not_on_current_page',checkedAt:'2026-09-14T00:00:00Z'};
 const screen=()=>({outcome:'collect'});screen.policyDigest='p';const options={candidateFile:file,stateFile:'data/china/workflow.json',pool:f.pool,screen,state:{jobs:{'boss:new':{latest:{hash:'new'}}},runs:[]},reviews:[review]};
 const a=await reconcileWorkflow(f.root,options);assert.equal(a.summary.held_not_found,1);assert.equal(a.scopeTasks[0].jobKey,'boss:new');assert.equal(a.records.filter(r=>r.state==='ready').length,0);
 const b=await reconcileWorkflow(f.root,{...options,reviews:[]});assert.equal(b.summary.held_not_found,1);assert.equal(b.reviews.length,1);
});

test('market views retain highlights and size while undecoded salary stays out of readable tables',async t=>{const f=await fixture(t);await publishMarketRelease(f.root,f);const jobs=readFileSync(join(f.root,'reports/china-market/current/jobs.md'),'utf8');assert.match(jobs,/重点公司/);assert.match(jobs,/100-499人/);assert.doesNotMatch(jobs,/[\uE000-\uF8FF]/);assert.match(jobs,/待解码/);});
test('reconcile exposes pending analysis and only reuses validated same-configuration analysis references',async t=>{
 const f=await fixture(t),file=join(f.root,'empty-cards.json');writeFileSync(file,JSON.stringify({records:[]}));const screen=()=>({outcome:'review'});screen.policyDigest='p';
 const args={candidateFile:file,stateFile:'data/china/workflow.json',pool:f.pool,screen,state:f.state};let w=await reconcileWorkflow(f.root,args);assert.equal(w.analysisTasks[0].state,'pending_analysis');
 await publishMarketRelease(f.root,f);args.pool=JSON.parse(readFileSync(join(f.root,'reports/china-market/current/pool.json')));w=await reconcileWorkflow(f.root,args);assert.equal(w.analysisTasks[0].state,'analyzed');assert.deepEqual(w.analysisTasks,JSON.parse(readFileSync(join(f.root,'reports/china-market/current/analysis-tasks.json'))).records);
 args.pool.configurationHash='changed-config';w=await reconcileWorkflow(f.root,args);assert.equal(w.analysisTasks[0].state,'pending_analysis');
});
test('release counts missing classifications as unknown and derives candidate totals from records',async t=>{
 const f=await fixture(t);f.candidates={policyDigest:'p',records:[],summary:{ready:99}};
 const result=await publishMarketRelease(f.root,f);assert.deepEqual(result.stats.channels,{unknown:1});assert.deepEqual(result.stats.candidateStates,{});
 const w=JSON.parse(readFileSync(join(f.root,'reports/china-market/current/candidate-workflow.json')));assert.deepEqual(w.summary,{});
});
test('report separates target city options from semantic comparison groups and exposes location conflicts',async t=>{
 const f=await fixture(t);f.bundle.records[0].cityGroup='conflict';
 const result=await publishMarketRelease(f.root,f);assert.deepEqual(result.stats.cityAnalysisGroups,{conflict:1});
 const jobs=readFileSync(join(f.root,'reports/china-market/current/jobs.md'),'utf8');assert.match(jobs,/地点分析状态/);assert.match(jobs,/conflict/);
});
test('publication refuses a ready card whose approved fact version has changed',async t=>{
 const f=await fixture(t);f.candidates={policyDigest:'p',records:[{key:'boss:next',card:{key:'boss:next',title:'其他岗位'},state:'ready',policyDigest:'p',listingVersion:'stale'}],summary:{ready:1}};
 await assert.rejects(publishMarketRelease(f.root,f),/candidate.*version/);
});
test('workflow does not overwrite a mismatched card identity before validation',async t=>{
 const f=await fixture(t),file=join(f.root,'bad-cards.json');writeFileSync(file,JSON.stringify({records:[{key:'boss:one',card:{key:'boss:other',title:'AI开发'}}]}));
 const screen=()=>({outcome:'collect'});screen.policyDigest='p';
 await assert.rejects(reconcileWorkflow(f.root,{candidateFile:file,stateFile:'workflow.json',pool:f.pool,screen,state:f.state}),/identity/);
 assert.equal(existsSync(join(f.root,'workflow.json')),false);
});
test('user defaults are applied in the published report without rewriting frozen salary inputs',async t=>{
 const f=await fixture(t);mkdirSync(join(f.root,'data/china'),{recursive:true});writeFileSync(join(f.root,'data/china/market-defaults.json'),JSON.stringify({providers:{boss:{currency:'CNY',period:'month',channel:'hr'}}}));
 f.classifications=[{jobKey:'boss:test',contentHash:f.pool.records[0].contentHash,channel:{value:'unknown'}}];
 await publishMarketRelease(f.root,f);const result=JSON.parse(readFileSync(join(f.root,'reports/china-market/current/classifications.json')));assert.equal(result.records[0].channel.status,'assumed');assert.equal(result.records[0].channel.value,'hr');
 const connection=JSON.parse(readFileSync(join(f.root,'reports/china-market/current/connections.json')));assert.equal(connection.interpretationDefaults.providers.boss.currency,'CNY');
});
test('publication binds classification source paths to the same frozen study as the active pool',async t=>{
 const f=await fixture(t);f.classifications=[{jobKey:f.pool.records[0].jobKey,contentHash:f.pool.records[0].contentHash,sourceRef:{path:'old-source.json'},channel:{value:'hr'}}];await publishMarketRelease(f.root,f);
 const pool=JSON.parse(readFileSync(join(f.root,'reports/china-market/current/active-pool.json'))),classes=JSON.parse(readFileSync(join(f.root,'reports/china-market/current/classifications.json')));assert.deepEqual(classes.records[0].sourceRef,pool.records[0].sourceRef);
});
