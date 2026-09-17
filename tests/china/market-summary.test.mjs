import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,options,analysis} from './fixtures/market-data.mjs';
import {buildStudy} from '../../china/market-study.mjs';
import {fingerprint} from '../../china/store.mjs';
import {collectLeaves,summarize,renderRequirementsCsv} from '../../china/market-summary.mjs';
function setup(t,count=1){
 const root=mkdtempSync(join(tmpdir(),'market-summary-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {state,selected}=seed(root),study=buildStudy(state,options(selected));
 for(let i=1;i<count;i++){const source=structuredClone(study.sources[0]);source.jobKey=`synthetic:${i}`;study.sources.push(source);study.manifest.selected.push({jobKey:source.jobKey,contentHash:source.contentHash});}
 study.manifest.sourceDigest=fingerprint({scope:study.manifest.scope,sources:study.sources});
 const bundle=analysis(study);for(let i=1;i<count;i++){const record=structuredClone(bundle.records[0]);record.jobKey=study.sources[i].jobKey;bundle.records.push(record);}
 return {study,bundle};
}
function node(base,id,extra={}){return {...structuredClone(base),id,...extra};}
test('duplicate subjects normalize conservatively and count distinct jobs',t=>{
 const {study,bundle}=setup(t,2),r=bundle.records[0];r.requirements[0].subject=' ＰＹＴＨＯＮ  ';bundle.records[1].requirements[0].subject='python';
 r.requirements.push(node(r.requirements[0],'r2',{subject:'Python'}));
 const out=summarize(study,bundle);assert.equal(out.rows.length,1);assert.equal(out.rows[0].subject,'python');assert.equal(out.rows[0].count,2);assert.equal(out.rows[0].denominator,2);assert.deepEqual(out.rows[0].jobKeys,study.sources.map(s=>s.jobKey).sort());
});
test('unreviewed dimensions leave numerator and denominator and retain zero-row group coverage',t=>{
 const {study,bundle}=setup(t,2);bundle.records[0].coverage.language='not_reviewed';bundle.records[1].requirements=[];
 const out=summarize(study,bundle);assert.equal(out.complete,false);assert.deepEqual(out.rows,[]);
 const group=out.missingness.groups.find(g=>g.dimension==='language');assert.equal(group.reviewed,1);assert.equal(group.notReviewed,1);assert.deepEqual(group.reviewedJobKeys,['synthetic:1']);
});
test('tree leaves propagate any/preferred/inferred and preserve unspecified roots',t=>{
 const {bundle}=setup(t),base=bundle.records[0].requirements[0];
 const tree=[node(base,'g',{logic:'any',necessity:'preferred',alternatives:[node(base,'a'),node(base,'b',{necessity:'unspecified'})]}),node(base,'u',{necessity:'unspecified'}),node(base,'i',{evidenceTier:'inferred',necessity:'unspecified',logic:'all',alternatives:[node(base,'c'),node(base,'d')]})];
 assert.deepEqual(collectLeaves(tree).map(x=>[x.requirement.id,x.alternative,x.necessity]),[['a',true,'preferred'],['b',true,'preferred'],['u',false,'unspecified']]);
});
test('all counts separate subjects; required child survives unspecified parent',t=>{
 const {study,bundle}=setup(t),base=bundle.records[0].requirements[0];bundle.records[0].requirements=[node(base,'g',{necessity:'unspecified',logic:'all',alternatives:[node(base,'a',{subject:'LangChain'}),node(base,'b',{subject:'LangGraph',necessity:'unspecified'})]})];
 assert.deepEqual(summarize(study,bundle).rows.map(r=>[r.subject,r.kind,r.count,r.denominator]),[['langchain','required',1,1],['langgraph','unspecified',1,1]]);
});
test('city and role group denominators stay isolated',t=>{
 const {study,bundle}=setup(t,3);bundle.records[1].cityGroup='上海';bundle.records[1].cityEvidence=[{field:'location',start:0,end:2,quote:'上海'}];bundle.records[2].roleFamily='engineering_solution';bundle.records[2].roleFamilyEvidence=bundle.records[2].requirements[0].evidence;
 const rows=summarize(study,bundle).rows;assert.equal(rows.length,3);assert.ok(rows.every(r=>r.count===1&&r.denominator===1));
});
test('all node details preserve evidence depth, paths and inferred branches',t=>{
 const {study,bundle}=setup(t),base=bundle.records[0].requirements[0];bundle.records[0].requirements=[node(base,'g',{logic:'any',necessity:'preferred',alternatives:[node(base,'a',{levelRaw:'精通',practice:['独立完成'],minimumYears:3,maximumYears:5}),node(base,'b',{necessity:'unspecified',evidenceTier:'inferred'})]})];
 const out=summarize(study,bundle);assert.equal(out.details.length,3);const d=out.details.find(x=>x.requirementId==='a');assert.equal(d.minimumYears,3);assert.equal(d.maximumYears,5);assert.deepEqual(d.practice,['独立完成']);assert.deepEqual(d.languageScenario,['reading']);assert.equal(d.quote,base.evidence.quote);assert.match(d.logicPath,/any/);assert.equal(d.effectiveNecessity,'preferred');assert.equal(out.rows[0].kind,'alternative_preferred');assert.equal(out.rows.length,1);
});
test('invalid bundle cannot bypass validation and inputs stay unchanged',t=>{
 const {study,bundle}=setup(t),before=JSON.stringify({study,bundle});const first=summarize(study,bundle);assert.equal(JSON.stringify({study,bundle}),before);assert.deepEqual(summarize(study,bundle),first);bundle.records[0].contentHash='bad';assert.throws(()=>summarize(study,bundle),/invalid_analysis/);
});
test('company null jobs are separate from identified company deduplication',t=>{
 const {study,bundle}=setup(t,4);for(const r of bundle.records.slice(0,2)){r.companyKey='合成公司';r.companyEvidence={field:'company',start:0,end:4,quote:'合成公司'};}
 const c=summarize(study,bundle).companyCoverage;assert.equal(c.distinctCompanies,1);assert.equal(c.identifiedJobs,2);assert.equal(c.anonymousOrUnknownJobs,2);assert.equal(c.companies[0].count,2);
});
test('salary keeps raw and readable without inventing numeric pay or posting dates',t=>{
 const {study,bundle}=setup(t,3);Object.assign(study.sources[0].fields,{salaryRaw:'\ue001K',salaryText:'20K',qualityFlags:['encoded_salary']});study.sources[1].fields.salaryRaw='面议';
 for(const s of study.sources){const {listingText,...content}=s.fields;s.contentHash=fingerprint(content);study.manifest.selected.find(x=>x.jobKey===s.jobKey).contentHash=s.contentHash;bundle.records.find(x=>x.jobKey===s.jobKey).contentHash=s.contentHash;}
 study.manifest.sourceDigest=fingerprint({scope:study.manifest.scope,sources:study.sources});bundle.sourceDigest=study.manifest.sourceDigest;
 const out=summarize(study,bundle),salary=out.missingness.salary;assert.equal(salary.encoded,0);assert.equal(salary.jobs.find(x=>x.jobKey===study.sources[0].jobKey).encoded,true);assert.equal(salary.readable,2);assert.equal(salary.notProvided,1);assert.equal(salary.jobs.find(x=>x.jobKey===study.sources[1].jobKey).salaryText,'面议');assert.deepEqual(out.missingness.postingDate,{status:'not_collected',jobs:3});
 study.sources[0].fields.salaryText=null;
 for(const s of study.sources){const {listingText,...content}=s.fields;s.contentHash=fingerprint(content);study.manifest.selected.find(x=>x.jobKey===s.jobKey).contentHash=s.contentHash;bundle.records.find(x=>x.jobKey===s.jobKey).contentHash=s.contentHash;}
 study.manifest.sourceDigest=fingerprint({scope:study.manifest.scope,sources:study.sources});bundle.sourceDigest=study.manifest.sourceDigest;
 const unresolved=summarize(study,bundle).missingness.salary;assert.equal(unresolved.encoded,1);assert.equal(unresolved.readable+unresolved.encoded+unresolved.notProvided,3);
});
test('CSV preserves commas quotes and newlines and escapes whitespace-prefixed formulae',()=>{
 const csv=renderRequirementsCsv({studyId:'test',details:[{jobKey:'job',subject:' \t=SUM(1,2)',quote:'say "hi",\nnext',practice:['a','b'],languageScenario:['reading']}]});
 assert.ok(csv.includes('"\' \t=SUM(1,2)"'));assert.ok(csv.includes('"say ""hi"",\nnext"'));assert.ok(csv.includes('"[""a"",""b""]"'));assert.equal(csv.split('\r\n')[0].split(',').length,18);
 for(const subject of ['+1','-1','@a','\uFEFF =X'])assert.ok(renderRequirementsCsv({studyId:'test',details:[{subject}]}).includes(`"'${subject}"`));
});
test('missingness distinguishes reviewed absence from unreviewed absence',t=>{
 const {study,bundle}=setup(t,2);bundle.records[0].requirements=[];bundle.records[1].coverage.language='not_reviewed';
 const group=summarize(study,bundle).missingness.groups.find(x=>x.dimension==='language');assert.equal(group.reviewedWithoutMention,1);assert.deepEqual(group.reviewedWithoutMentionJobKeys,[study.sources[0].jobKey]);
});
test('overlapping necessity categories deduplicate independently',t=>{
 const {study,bundle}=setup(t),r=bundle.records[0],base=r.requirements[0];r.requirements.push(node(base,'p',{necessity:'preferred'}),node(base,'p2',{necessity:'preferred'}));
 const rows=summarize(study,bundle).rows;assert.deepEqual(rows.map(x=>[x.kind,x.count,x.denominator]),[['preferred',1,1],['required',1,1]]);
});
test('nested any ancestor and required parent reach unspecified descendants',t=>{
 const {bundle}=setup(t),base=bundle.records[0].requirements[0];const tree=[node(base,'a',{logic:'any',alternatives:[node(base,'b',{logic:'all',necessity:'unspecified',alternatives:[node(base,'c',{necessity:'unspecified'}),node(base,'d')]}),node(base,'e')]})];
 assert.deepEqual(collectLeaves(tree).map(x=>[x.requirement.id,x.necessity,x.alternative]),[['c','required',true],['d','required',true],['e','required',true]]);
});
test('conflicts retain raw evidence and count affected jobs independently',t=>{
 const {study,bundle}=setup(t),r=bundle.records[0],e=r.requirements[0].evidence;r.conflicts=[{field:'language',evidence:[e,e],note:'two claims'}, {field:'experience',evidence:[e,e],note:'another claim'}];
 const out=summarize(study,bundle);assert.deepEqual(out.missingness.conflicts,{jobs:1,count:2});assert.equal(out.conflicts[1].evidence[0].quote,e.quote);assert.equal(out.conflicts[0].jobKey,r.jobKey);
});
test('CSV shows inherited preference and keeps zero years',t=>{
 const {study,bundle}=setup(t),base=bundle.records[0].requirements[0];bundle.records[0].requirements=[node(base,'g',{logic:'all',necessity:'preferred',alternatives:[node(base,'a',{minimumYears:0}),node(base,'b')]})];
 const summary=summarize(study,bundle),csv=renderRequirementsCsv(summary);const line=csv.split('\r\n').find(s=>s.includes('"a"'));assert.ok(line.includes('"preferred"'));assert.ok(line.includes('"0"'));assert.equal(summary.details.find(d=>d.requirementId==='a').rawNecessity,'required');
});
test('group details retain the original condition tree for audit',t=>{
 const {study,bundle}=setup(t),base=bundle.records[0].requirements[0];const group=node(base,'group',{logic:'any',alternatives:[node(base,'x'),node(base,'y',{necessity:'preferred'})]});bundle.records[0].requirements=[group];
 const details=summarize(study,bundle).details;assert.deepEqual(details.find(x=>x.requirementId==='group').alternatives,group.alternatives);details.find(x=>x.requirementId==='group').alternatives[0].subject='changed';assert.equal(group.alternatives[0].subject,'英语阅读');
});
