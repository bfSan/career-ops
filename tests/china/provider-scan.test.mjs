import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordObservation,openStore,saveStore} from '../../china/store.mjs';
import {prepareStudy} from '../../china/market-study.mjs';
import {createArchiveProvider} from '../../china/provider-plugin.mjs';
import {readJobSource} from '../../job-source.mjs';
import {scanFixture} from './fixtures/provider-scan.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';

test('actual scan filters, publishes archive refs, preserves employer, and deduplicates',async t=>{
  const root=mkdtempSync(join(tmpdir(),'provider-scan-data-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state=openStore(root),selected=[];
  const description='负责RAG服务的研发和上线，要求能够独立完成后端服务设计、自动化测试、性能优化以及生产系统的维护。';
  for(const [id,title,location,company] of [['keep','AI工程师','上海','真实雇主甲'],['sales','销售专员','上海','真实雇主乙'],['other-city','AI工程师','杭州','真实雇主丙']]){
    const job=recordObservation(root,state,{platform:'boss',url:`https://www.zhipin.com/job_detail/${id}.html?track=1`,title,location,company,description,status:'ok',observedAt:'2026-09-12T00:00:00Z'});
    selected.push({jobKey:job.key,contentHash:job.latest.hash});
  }
  saveStore(root,state);
  await prepareStudy(root,{studyId:'scan-fixture',selected,scope:{cities:['上海','杭州'],keywords:['AI'],queryUrls:[]},createdAt:'2026-09-12T01:00:00Z'});
  assert.equal((await createArchiveProvider('boss').fetch({study_id:'scan-fixture'},{dataRoot:root})).length,3);
  writeFileSync(join(root,'portals.yml'),JSON.stringify({title_filter:{positive:['AI工程师']},location_filter:{allow:['上海']},content_filter:{positive:['RAG']},job_boards:[{name:'domestic-fixture',provider:'career-boss',study_id:'scan-fixture',enabled:true,aggregator:true}]}));
  const fixture=scanFixture(t,root);
  const dry=fixture.run(['--dry-run']);assert.equal(dry.status,0,dry.stderr+dry.stdout);
  assert.equal(existsSync(join(root,'data/job-sources')),false);assert.equal(existsSync(join(root,'data/pipeline.md')),false);
  const first=fixture.run();assert.equal(first.status,0,first.stderr+first.stdout);
  assert.match(first.stdout,/Total jobs found:\s+3/);
  const pipeline=readFileSync(join(root,'data/pipeline.md'),'utf8'),rows=pipeline.split('\n').filter(s=>s.startsWith('- [ ]'));
  assert.equal(rows.length,1,pipeline);assert.match(rows[0],/真实雇主甲 \| AI工程师 \| 上海/);
  const ref=rows[0].match(/archive_ref=(\S+)/)?.[1];assert.ok(ref);
  assert.equal((await readJobSource(root,{url:'https://www.zhipin.com/job_detail/keep.html',ref})).description,description);
  const history=readFileSync(join(root,'data/scan-history.tsv'),'utf8').split('\n').map(s=>s.split('\t')).filter(r=>r[5]==='added');
  assert.equal(history.length,1);assert.equal(history[0][2],'career-boss-api');assert.equal(history[0][4],'真实雇主甲');
  const second=fixture.run();assert.equal(second.status,0,second.stderr+second.stdout);
  assert.equal(readFileSync(join(root,'data/pipeline.md'),'utf8'),pipeline);
  assert.equal(existsSync(join(root,'data/applications.md')),false);
});

test('original repost CLI detects changed URLs across days but excludes same-day copies',t=>{
  const root=mkdtempSync(join(tmpdir(),'provider-reposts-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'data'));
  writeFileSync(join(root,'data/scan-history.tsv'),[
    'url\tdate\tsource\ttitle\tcompany\tstatus',
    'https://www.zhipin.com/job_detail/old.html\t2026-08-01\tcareer-boss-api\tAI Engineer\tFixture Corp\tadded',
    'https://www.zhipin.com/job_detail/new.html\t2026-09-01\tcareer-boss-api\tAI Engineer\tFixture Corp\tadded',
    'https://www.zhipin.com/job_detail/same1.html\t2026-09-01\tcareer-boss-api\tAI Engineer\tOther Corp\tadded',
    'https://www.zhipin.com/job_detail/same2.html\t2026-09-01\tcareer-boss-api\tAI Engineer\tOther Corp\tadded',''].join('\n'));
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../../detect-reposts.mjs',import.meta.url))],{env:{...process.env,CAREER_OPS_ROOT:root},encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.clusters.length,1);assert.equal(result.clusters[0].company,'Fixture Corp');
});
