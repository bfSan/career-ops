import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed, options, analysis } from './fixtures/market-data.mjs';
import { buildStudy } from '../../china/market-study.mjs';
import { fingerprint } from '../../china/store.mjs';
import { validateBundle, checkEvidence } from '../../china/market-analysis.mjs';
function setup(t) {
 const root=mkdtempSync(join(tmpdir(),'market-validator-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {state,selected}=seed(root); const study=buildStudy(state,options(selected));return {study,bundle:analysis(study)};
}
test('exact Chinese evidence passes and reviewed absence differs from partial',t=>{
 const {study,bundle}=setup(t); assert.equal(checkEvidence(study.sources[0],bundle.records[0].requirements[0].evidence),true);
 assert.deepEqual(validateBundle(study,bundle),{valid:true,complete:true,errors:[],missingJobKeys:[],unreviewed:[]});
 bundle.records[0].requirements=[];assert.equal(validateBundle(study,bundle).complete,true);
 bundle.records[0].coverage.language='not_reviewed'; const result=validateBundle(study,bundle);assert.equal(result.valid,true);assert.equal(result.complete,false);assert.deepEqual(result.unreviewed,[{jobKey:study.sources[0].jobKey,dimension:'language'}]);
});
const mutations={
 'wrong quote':(b,r,n)=>n.evidence.quote='流利', 'wrong offset':(b,r,n)=>n.evidence.start++, 'empty quote':(b,r,n)=>n.evidence.quote='',
 'unsupported evidence field':(b,r,n)=>n.evidence.field='queryRefs', 'metadata requirement':(b,r,n)=>n.evidence={field:'location',start:0,end:2,quote:'上海'},
 'wrong hash':(b,r)=>r.contentHash='bad','wrong digest':b=>b.sourceDigest='bad','wrong study':b=>b.studyId='bad','wrong version':(b,r)=>r.analysisVersion='v2',
 'duplicate jobs':(b,r)=>b.records.push(structuredClone(r)),'missing job':b=>b.records=[],'unknown job':(b,r)=>r.jobKey='unknown',
 'extra field':(b,r,n)=>n.hardness='hard','missing field':(b,r,n)=>delete n.practice,'enum':(b,r,n)=>n.necessity='hard',
 'duplicate id':(b,r,n)=>{n.logic='any';n.alternatives=[structuredClone(n),structuredClone(n)];},
 'single children':(b,r,n)=>n.alternatives=[structuredClone(n)],'empty any':(b,r,n)=>n.logic='any',
 'negative years':(b,r,n)=>n.minimumYears=-1,'reversed years':(b,r,n)=>{n.minimumYears=8;n.maximumYears=2;},
 'infinite years':(b,r,n)=>n.maximumYears=Infinity,'inferred required':(b,r,n)=>n.evidenceTier='inferred',
 'city without evidence':(b,r)=>r.cityGroup='上海','family without evidence':(b,r)=>r.roleFamily='application_agent',
 'company without evidence':(b,r)=>r.companyKey='company','empty conflict':(b,r)=>r.conflicts=[{field:'experience',evidence:[],note:'冲突'}],
 'bad coverage':(b,r)=>r.coverage.language=true,'extra coverage':(b,r)=>r.coverage.other='reviewed',
 'null record':b=>b.records=[null],'bad array':(b,r)=>r.requirements={},'bad scalar':(b,r,n)=>n.subject=12,
};
for(const [name,mutate] of Object.entries(mutations))test(name+' is invalid, never partial',t=>{const {study,bundle}=setup(t);mutate(bundle,bundle.records[0],bundle.records[0].requirements[0]);const result=validateBundle(study,bundle);assert.equal(result.valid,false);assert.equal(result.complete,false);assert.ok(result.errors.every(e=>typeof e.path==='string'&&typeof e.code==='string'));});
test('bounded nested trees accept 8 levels, reject 9 and over 500 nodes',t=>{
 const {study,bundle}=setup(t);const r=bundle.records[0],leaf=structuredClone(r.requirements[0]);let id=0;
 const make=depth=>depth===1?{...structuredClone(leaf),id:String(id++)}:{...structuredClone(leaf),id:String(id++),logic:'all',alternatives:[make(depth-1),{...structuredClone(leaf),id:String(id++)}]};
 r.requirements=[make(8)];assert.equal(validateBundle(study,bundle).valid,true);r.requirements=[make(9)];assert.equal(validateBundle(study,bundle).valid,false);
 r.requirements=Array.from({length:501},()=>({...structuredClone(leaf),id:String(id++)}));assert.equal(validateBundle(study,bundle).valid,false);
});
test('unbound listing and damaged study cannot validate even with matching supplied digest',t=>{
 const {study,bundle}=setup(t);const e={field:'listingText',start:0,end:7,quote:study.sources[0].fields.listingText.slice(0,7)};
 assert.equal(checkEvidence(study.sources[0],e),true);study.sources[0].listingBinding='unbound';assert.equal(checkEvidence(study.sources[0],e),false);
 study.sources[0].fields.description+='篡改';study.manifest.sourceDigest=fingerprint({scope:study.manifest.scope,sources:study.sources});bundle.sourceDigest=study.manifest.sourceDigest;
 assert.equal(validateBundle(study,bundle).valid,false);
});
test('malformed inputs and inconsistent manifest are reported without throwing',t=>{
 const {study,bundle}=setup(t);for(const malformed of [null,{},[],{manifest:null,sources:[null]}])assert.equal(validateBundle(malformed,bundle).valid,false);
 for(const malformed of [null,{},[],{records:[null]}])assert.equal(validateBundle(study,malformed).valid,false);
 study.manifest.selected=[];assert.equal(validateBundle(study,bundle).valid,false);
 assert.equal(checkEvidence(null,null),false);
});
test('anonymous source company cannot acquire a company key through a relabeled key',t=>{
 const {study,bundle}=setup(t),source=study.sources[0],r=bundle.records[0];
 source.fields.company='某大型公司';const {listingText,...content}=source.fields;source.contentHash=fingerprint(content);
 study.manifest.selected[0].contentHash=source.contentHash;r.contentHash=source.contentHash;
 study.manifest.sourceDigest=fingerprint({scope:study.manifest.scope,sources:study.sources});bundle.sourceDigest=study.manifest.sourceDigest;
 r.companyKey='large-enterprise';r.companyEvidence={field:'company',start:0,end:5,quote:'某大型公司'};
 assert.equal(validateBundle(study,bundle).valid,false);
});
test('supported metadata references and grounded conflicts remain valid',t=>{
 const {study,bundle}=setup(t),r=bundle.records[0];
 r.cityGroup='上海';r.cityEvidence=[{field:'location',start:0,end:2,quote:'上海'}];
 r.companyKey='合成公司';r.companyEvidence={field:'company',start:0,end:4,quote:'合成公司'};
 r.roleFamily='application_agent';r.roleFamilyEvidence=structuredClone(r.requirements[0].evidence);
 r.conflicts=[{field:'experience',note:'两段证据需人工检查',evidence:[structuredClone(r.requirements[0].evidence),{field:'listingText',start:15,end:19,quote:study.sources[0].fields.listingText.slice(15,19)}]}];
 // Exact offsets may cite a semantically weak span: semantic review is explicitly outside this validator.
 assert.equal(validateBundle(study,bundle).valid,true);
});
test('invalid year types return diagnostics without coercing JSON objects',t=>{
 const {study,bundle}=setup(t),n=bundle.records[0].requirements[0];
 for(const value of [{toString:null},{valueOf:null,toString:null},'5',[],true]) {
  n.minimumYears=0;n.maximumYears=value;
  const result=validateBundle(study,JSON.parse(JSON.stringify(bundle)));
  assert.equal(result.valid,false);assert.equal(result.complete,false);
  assert.ok(result.errors.some(e=>e.path.endsWith('.maximumYears')));
 }
});
test('malformed source identifiers never leak non-string payloads into diagnostics',t=>{
 const {study,bundle}=setup(t);
 for(const value of [{privatePayload:'synthetic private material'},['synthetic private material'],null]) {
  study.sources[0].jobKey=value;
  const result=validateBundle(study,bundle);
  assert.equal(result.valid,false);
  assert.ok(result.errors.every(e=>e.jobKey===null||typeof e.jobKey==='string'));
  assert.ok(result.missingJobKeys.every(k=>typeof k==='string'));
  assert.equal(JSON.stringify(result).includes('synthetic private material'),false);
 }
});
