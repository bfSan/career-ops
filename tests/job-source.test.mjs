import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,options,description} from './china/fixtures/market-data.mjs';
import {prepareStudy} from '../china/market-study.mjs';
import {recordObservation,saveStore} from '../china/store.mjs';
import {createArchiveProvider} from '../china/provider-plugin.mjs';
import {publishJobSource,readJobSource,withArchiveNote} from '../job-source.mjs';

async function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'job-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const data=seed(root);await prepareStudy(root,options(data.selected));
  const [job]=await createArchiveProvider('boss').fetch({study_id:'market-fixture'},{dataRoot:root});
  return {root,...data,offer:job};
}
test('immutable version refs retain old JD after a newer capture, private and concurrent',async t=>{
  const f=await fixture(t);
  const refs=await Promise.all([publishJobSource(f.root,f.offer),publishJobSource(f.root,f.offer)]);
  assert.equal(refs[0],refs[1]);assert.match(refs[0],/^data\/job-sources\/[a-f0-9]{20}\/[a-f0-9]{20}\.json$/);
  assert.equal(statSync(join(f.root,refs[0])).mode&0o777,0o600);
  assert.ok(!readFileSync(join(f.root,refs[0]),'utf8').includes(description));
  const changed=recordObservation(f.root,f.state,{...f.job.latest,platform:'boss',url:f.job.url,status:'ok',description:description+'新增模型评估职责。',observedAt:'2026-09-12T00:00:00Z'});
  saveStore(f.root,f.state);
  await prepareStudy(f.root,{...options([{jobKey:changed.key,contentHash:changed.latest.hash}]),studyId:'new-version'});
  const [next]=await createArchiveProvider('boss').fetch({study_id:'new-version'},{dataRoot:f.root});
  const newRef=await publishJobSource(f.root,next);assert.notEqual(newRef,refs[0]);
  assert.equal((await readJobSource(f.root,{url:f.offer.url,ref:refs[0]})).description,description);
  assert.equal((await readJobSource(f.root,{url:next.url,ref:newRef})).description,description+'新增模型评估职责。');
  const note=withArchiveNote({...f.offer,note:'保留说明'},refs[0]);
  assert.match(note.note,/^保留说明/);assert.equal(withArchiveNote(note,refs[0]).note,note.note);
});
test('source references reject traversal, wrong URL, corruption and symlinks',async t=>{
  const f=await fixture(t),ref=await publishJobSource(f.root,f.offer),file=join(f.root,ref);
  await assert.rejects(()=>readJobSource(f.root,{url:f.offer.url,ref:'../secret.json'}));
  await assert.rejects(()=>readJobSource(f.root,{url:'https://www.zhipin.com/job_detail/wrong.html',ref}));
  const original=readFileSync(file);writeFileSync(file,'{}');
  await assert.rejects(()=>readJobSource(f.root,{url:f.offer.url,ref}));writeFileSync(file,original);
  const capture=join(f.root,f.offer.sourceRef.capturePath),raw=readFileSync(capture);
  writeFileSync(capture,raw.toString().replace(description,description+'篡改'));
  await assert.rejects(()=>readJobSource(f.root,{url:f.offer.url,ref}));writeFileSync(capture,raw);
  rmSync(file);writeFileSync(file+'.real',original);symlinkSync(file+'.real',file);
  await assert.rejects(()=>readJobSource(f.root,{url:f.offer.url,ref}));
  await assert.rejects(()=>publishJobSource(f.root,f.offer));
});
