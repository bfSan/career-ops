import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {seed,options,analysis} from './fixtures/market-data.mjs';
import {recordObservation,saveStore,fingerprint} from '../../china/store.mjs';
import {prepareStudy,readStudy} from '../../china/market-study.mjs';
import {parseCompensation} from '../../compensation.mjs';import {parsePostingDate} from '../../posting-dates.mjs';
import {summarize} from '../../china/market-summary.mjs';import {validateBundle} from '../../china/market-analysis.mjs';
import {saveReport} from '../../china-market.mjs';import {createArchiveProvider} from '../../china/provider-plugin.mjs';
import {scanFixture} from './fixtures/provider-scan.mjs';
test('v2 freezes evidence facts and serves core/market consumers without changing a v1 report',async t=>{
 const root=mkdtempSync(join(tmpdir(),'market-v2-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=seed(root),v1=await prepareStudy(root,options(f.selected)),b1=analysis(v1);
 const saved=await saveReport(root,v1,b1,summarize(v1,b1));
 const names=['summary.json','analysis.json','validation.json','requirements.csv','market-report.md'],before=names.map(n=>readFileSync(join(saved.reportDir,n)));
 const at='2026-09-12T00:00:00.000Z';
 recordObservation(root,f.state,{...f.job.latest,platform:'boss',url:f.job.url,status:'ok',observedAt:at,facts:{schemaVersion:1,
  compensation:parseCompensation({raw:'30–50K·13薪',currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:'人民币月薪30–50K·13薪'}]}),
  dates:[parsePostingDate({kind:'published',raw:'今天发布',observedAt:at,timezone:'Asia/Shanghai',evidence:{field:'visibleText',quote:'今天发布'}})]}});
 const second=recordObservation(root,f.state,{...f.job.latest,platform:'boss',url:'https://www.zhipin.com/job_detail/undated.html',status:'ok',observedAt:at});saveStore(root,f.state);
 const v2=await prepareStudy(root,{...options([...f.selected,{jobKey:second.key,contentHash:second.latest.hash}]),studyId:'v2-fixture',schemaVersion:2,createdAt:'2026-09-12T01:00:00Z'});
 const bundle={...analysis(v2),schemaVersion:2,records:v2.sources.flatMap(s=>analysis({manifest:v2.manifest,sources:[s]}).records)};
 assert.equal(validateBundle(v2,bundle).valid,true);const summary=summarize(v2,bundle);
 assert.equal(summary.missingness.postingDate.known,1);assert.equal(summary.missingness.postingDate.notCollected,1);
 assert.equal(summary.compensationGroups[0].medianRangeMidpoint,480000);assert.equal(summary.compensationGroups[0].jobs,1);
 const jobs=await createArchiveProvider('boss').fetch({study_id:'v2-fixture'},{dataRoot:root});
 assert.deepEqual(jobs[0].salary,{min:360000,max:600000,currency:'CNY'});assert.equal(jobs[0].postedAt,Date.parse('2026-09-11T16:00:00Z'));assert.equal(jobs[1].salary,undefined);
 assert.equal((await createArchiveProvider('boss').fetch({study_id:'market-fixture'},{dataRoot:root}))[0].salary,undefined);
 const bad=structuredClone(v1);bad.sources[0].facts=v2.sources[0].facts;bad.manifest.sourceDigest=fingerprint({scope:bad.manifest.scope,sources:bad.sources});
 assert.equal(validateBundle(bad,{...b1,sourceDigest:bad.manifest.sourceDigest}).valid,false);
 const file=join(root,'v2-analysis.json');writeFileSync(file,JSON.stringify(bundle));
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../../china-market.mjs',import.meta.url)),'connect','--root',root,'--study','v2-fixture','--file',file],{encoding:'utf8',timeout:10000});assert.equal(cli.status,0,cli.stderr);
 const connected=JSON.parse(readFileSync(join(JSON.parse(cli.stdout).connectionDir,'connections.json')));
 assert.equal(connected.schemaVersion,2);assert.equal(connected.timeline[0].publishedAt.status,'known');
 assert.equal(connected.compensationGroups[0].medianRangeMidpoint,480000);
 await saveReport(root,readStudy(root,'market-fixture'),b1,summarize(v1,b1));names.forEach((n,i)=>assert.deepEqual(readFileSync(join(saved.reportDir,n)),before[i]));
 writeFileSync(join(root,'portals.yml'),JSON.stringify({salary_filter:{min:300000,currency:'CNY'},job_boards:[{name:'v2',provider:'career-boss',study_id:'v2-fixture',enabled:true,aggregator:true}]}));
 const scan=scanFixture(t,root).run(['--posted-after','2026-09-12','--posted-before','2026-09-12']);assert.equal(scan.status,0,scan.stderr+scan.stdout);
 const pipeline=readFileSync(join(root,'data/pipeline.md'),'utf8');assert.match(pipeline,/360000.*600000 CNY/);assert.match(pipeline,/posted: 2026-09-12/);
});
test('parsed daily wages are counted separately rather than reported as an unresolved salary',async t=>{
 const root=mkdtempSync(join(tmpdir(),'market-day-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=seed(root),at='2026-09-12T00:00:00.000Z';
 recordObservation(root,f.state,{...f.job.latest,platform:'boss',url:f.job.url,status:'ok',observedAt:at,facts:{schemaVersion:1,compensation:parseCompensation({raw:'200-300元/天',currency:'CNY',period:'day',evidence:[{field:'visibleText',quote:'200-300元/天'}]}),dates:[]}});saveStore(root,f.state);
 const study=await prepareStudy(root,{...options(f.selected),studyId:'daily-wages',schemaVersion:2,createdAt:at});const bundle={...analysis(study),schemaVersion:2};const summary=summarize(study,bundle);
 assert.equal(summary.missingness.compensation.unresolved,0);assert.equal(summary.missingness.compensation.nonAnnual,1);assert.equal(summary.compensationGroups.length,0);
});
