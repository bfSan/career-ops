import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {fingerprint} from '../../china/store.mjs';import {readStudy} from '../../china/market-study.mjs';
import {DIMENSIONS} from '../../china/market-analysis.mjs';
const entry=fileURLToPath(new URL('../../china-market.mjs',import.meta.url));
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'market-sources-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const fields={title:'推理工程师',company:'合成官方企业',location:'上海',description:'负责开发模型推理运行时，排查性能瓶颈并交付可靠服务。要求熟悉Python以及分布式系统，完成上线验证。',sourceProvenance:{provider:'fixture-board',sourceId:'j-1',originalHash:'provider-raw-hash',sourceFile:'saved-board.json'}};
 const source={jobKey:'fixture-board:j-1',contentHash:fingerprint(fields),capturePath:'jds/china/fixture-board-j-1.md',observedAt:'2026-09-14T01:00:00.000Z',latestAttempt:{status:'ok',at:'2026-09-14T01:00:00.000Z'},listingBinding:'unbound',fields:{...fields,listingText:''},queryRefs:[],facts:null};
 mkdirSync(join(root,'jds/china'),{recursive:true});writeFileSync(join(root,source.capturePath),`**Job ID:** j-1\n\n${fields.description}\n`,{mode:0o600});
 const input={scope:{cities:['上海'],keywords:['AI'],queryUrls:[]},sources:[source]},file=join(root,'sources.json');
 const put=()=>writeFileSync(file,JSON.stringify(input),{mode:0o600});put();
 const run=args=>spawnSync(process.execPath,[entry,...args,'--root',root],{encoding:'utf8',timeout:10000});
 const args=['prepare','--study','official-fixture','--sources',file,'--schema-version','2'];
 return{root,input,file,put,run,args,source};
}
test('offline source input enters prepare and connect without synthesizing a domestic store record',t=>{
 const f=fixture(t),raw=readFileSync(join(f.root,f.source.capturePath)),r=f.run(f.args);assert.equal(r.status,0,r.stderr);
 const study=readStudy(f.root,'official-fixture');assert.equal(study.sources[0].jobKey,'fixture-board:j-1');assert.equal(study.sources[0].fields.sourceProvenance.originalHash,'provider-raw-hash');
 const q='Python',start=f.source.fields.description.indexOf(q);
 const bundle={schemaVersion:2,studyId:study.manifest.studyId,sourceDigest:study.manifest.sourceDigest,records:[{jobKey:f.source.jobKey,contentHash:f.source.contentHash,analysisVersion:'market-v1',analyzedAt:'2026-09-14T02:00:00.000Z',roleFamily:'unknown',roleFamilyEvidence:null,cityGroup:'unknown',cityEvidence:[],companyKey:null,companyEvidence:null,coverage:Object.fromEntries(DIMENSIONS.map(d=>[d,'reviewed'])),requirements:[{id:'python',dimension:'skill',subject:'Python',necessity:'required',evidenceTier:'stated',evidence:{field:'description',start,end:start+q.length,quote:q},levelRaw:'熟悉',practice:[],minimumYears:null,maximumYears:null,languageScenario:[],logic:'single',alternatives:[]}],conflicts:[]}]};
 const analysis=join(f.root,'analysis.json');writeFileSync(analysis,JSON.stringify(bundle));const c=f.run(['connect','--study','official-fixture','--file',analysis]);assert.equal(c.status,0,c.stderr);
 const result=JSON.parse(c.stdout),connection=JSON.parse(readFileSync(join(result.connectionDir,'connections.json')));assert.ok(connection.skills.rows.some(r=>r.skill==='Python'&&r.count===1));assert.equal(connection.timeline[0].storeRecordAvailable,false);assert.equal(connection.timeline[0].firstSuccessfullyCapturedAt,null);
 assert.equal(existsSync(join(f.root,'data/china/store.json')),false);assert.deepEqual(readFileSync(join(f.root,f.source.capturePath)),raw);
 assert.equal(f.run(f.args).status,1);assert.deepEqual(readStudy(f.root,'official-fixture'),study);
});
test('source content mismatch and malformed source records cannot be published',t=>{
 const f=fixture(t);f.input.sources[0].fields.description+=' changed';f.put();const r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/content_hash_mismatch/);assert.equal(existsSync(join(f.root,'data/china/research/official-fixture')),false);
});
test('source input refuses duplicate identities and text attached to an unbound listing',t=>{
 const f=fixture(t);f.input.sources.push(structuredClone(f.source));f.put();let r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/duplicate/);
 f.input.sources.length=1;f.source.listingBinding='unbound';f.source.fields.listingText='Unbound new listing';f.put();r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/unbound.*listing|listing.*unbound/);
});
test('missing archives and escaped archive symlinks fail before a study is created',t=>{
 const f=fixture(t),archive=join(f.root,f.source.capturePath);rmSync(archive);let r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/capture/);
 const outside=join(f.root,'outside.md');writeFileSync(outside,`**Job ID:** j-1\n${f.source.fields.description}`);symlinkSync(outside,archive);r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/capture/);assert.equal(existsSync(join(f.root,'data/china/research/official-fixture')),false);
});
test('source input requires explicit v2 and is mutually exclusive with selection and analysis inputs',t=>{
 const f=fixture(t);for(const args of [f.args.slice(0,-2),[...f.args,'--selection',f.file],[...f.args,'--file',f.file],['validate','--study','official-fixture','--file',f.file,'--sources',f.file]]){const r=f.run(args);assert.equal(r.status,1);assert.match(r.stderr,/sources|schema-version/);}
 assert.equal(existsSync(join(f.root,'data')),false);
});
test('source input rejects missing facts and unknown payload keys before publication',t=>{
 const f=fixture(t);f.input.extra=true;f.put();let r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/accepts only|invalid.*option/);
 delete f.input.extra;delete f.source.facts;f.put();r=f.run(f.args);assert.equal(r.status,1);assert.match(r.stderr,/missing_field|facts/);
});
test('explicit market preparation admits only reviewed identities and exact source versions',t=>{
 const f=fixture(t),pool={configurationHash:'cfg',records:[]},path=join(f.root,'pool.json');const put=()=>writeFileSync(path,JSON.stringify(pool));put();
 const args=[...f.args,'--market-pool',path,'--configuration-hash','cfg'];let r=f.run(args);assert.equal(r.status,1);assert.match(r.stderr,/market eligibility/);assert.equal(existsSync(join(f.root,'data/china/research/official-fixture')),false);
 pool.records=[{jobKey:f.source.jobKey,contentHash:f.source.contentHash,sourceRef:{jobKey:f.source.jobKey,contentHash:f.source.contentHash},eligibility:{value:'eligible',scopeReview:'reviewed',evidence:[{quote:'负责开发'}]},location:{targetCities:['上海'],evidence:[{quote:'上海'}]}}];put();r=f.run(args);assert.equal(r.status,0,r.stderr);
 r=f.run(['connect','--study','official-fixture','--file',f.file,'--market-pool',path,'--configuration-hash','cfg']);assert.equal(r.status,1);assert.match(r.stderr,/only.*prepare/);
});
