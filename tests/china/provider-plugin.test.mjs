import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createArchiveProvider, validateFrozenArchive } from '../../china/provider-plugin.mjs';
import { prepareStudy } from '../../china/market-study.mjs';
import { seed, options, description } from './fixtures/market-data.mjs';
import { openStore, recordObservation, saveStore, fingerprint } from '../../china/store.mjs';

test('archive validator rejects truncated JD and an archive filename bound to another hash', async t => {
  const { root } = await fixture(t);
  const sources = JSON.parse(readFileSync(join(root, 'data/china/research/market-fixture/source-jobs.json')));
  const source = sources[0];
  const wrong = { ...source, capturePath: 'jds/china/copied.md' };
  writeFileSync(join(root, wrong.capturePath), readFileSync(join(root, source.capturePath)));
  assert.throws(() => validateFrozenArchive(root, wrong), /archive_corrupt/);
  source.fields.description = '预览';
  const { listingText, ...content } = source.fields;
  source.contentHash = fingerprint(content);
  const old = readFileSync(join(root, source.capturePath), 'utf8');
  source.capturePath = `jds/china/boss-marketfixture-${source.contentHash}.md`;
  writeFileSync(join(root, source.capturePath), old.replace(description, '预览'));
  assert.throws(() => validateFrozenArchive(root, source), /incomplete/);
});

function bytes(root) {
  const out = new Map();
  const visit = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else out.set(relative(root, path), stat.isSymbolicLink() ? `link:${readFileSync(path, 'utf8')}` : readFileSync(path).toString('hex'));
    }
  };
  visit(root);
  return out;
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'archive-provider-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seeded = seed(root);
  await prepareStudy(root, options(seeded.selected));
  return { root, seeded };
}

test('boss archive provider returns complete frozen job facts without changing data', async t => {
  const { root } = await fixture(t);
  const before = bytes(root);
  const jobs = await createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root });
  assert.equal(createArchiveProvider('boss').id, 'career-boss');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, 'https://www.zhipin.com/job_detail/marketfixture.html');
  assert.equal(jobs[0].company, '合成公司');
  assert.equal(jobs[0].description, description);
  assert.equal(jobs[0].salary, undefined);
  assert.deepEqual(jobs[0].sourceRef, {
    schemaVersion: 1, providerId: 'career-boss', platform: 'boss', jobKey: 'boss:marketfixture',
    contentHash: '49d4e6588f04f635cc29', capturePath: 'jds/china/boss-marketfixture-49d4e6588f04f635cc29.md',
    observedAt: '2026-09-10T00:00:00.000Z', availability: 'not_rechecked', studyId: 'market-fixture',
  });
  assert.deepEqual(bytes(root), before);
});

test('provider requires a study id and reports missing study, absent platform, and corrupt archive', async t => {
  const { root } = await fixture(t);
  await assert.rejects(() => createArchiveProvider('boss').fetch({}, { dataRoot: root }), /study_id/);
  await assert.rejects(() => createArchiveProvider('boss').fetch({ study_id: 'absent-study' }, { dataRoot: root }), /study_not_found/);
  await assert.rejects(() => createArchiveProvider('liepin').fetch({ study_id: 'market-fixture' }, { dataRoot: root }), /platform_archive_unavailable/);
  const capture = join(root, 'jds/china/boss-marketfixture-49d4e6588f04f635cc29.md');
  writeFileSync(capture, readFileSync(capture, 'utf8').replace(description, `${description}篡改`));
  await assert.rejects(() => createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root }), /archive_corrupt/);
});

test('company size survives frozen provider and original archive source reader',async t=>{
 const root=mkdtempSync(join(tmpdir(),'size-provider-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {state,job}=seed(root);
 recordObservation(root,state,{...job.latest,platform:'boss',url:job.url,status:'ok',observedAt:'2026-09-13T00:00:00Z',companySizeRaw:'100-499人',companySizeEvidence:{field:'listingCompanyMetadata',quote:'100-499人'}});saveStore(root,state);
 await prepareStudy(root,options([{jobKey:job.key,contentHash:job.latest.hash}]));
 const [projected]=await createArchiveProvider('boss').fetch({study_id:'market-fixture'},{dataRoot:root});
 assert.equal(projected.companySizeRaw,'100-499人');
 const {publishJobSource,readJobSource}=await import('../../job-source.mjs');
 const ref=await publishJobSource(root,projected),read=await readJobSource(root,{url:projected.url,ref});
 assert.equal(read.job.companySizeRaw,'100-499人');assert.equal(read.job.companySizeEvidence.quote,'100-499人');
});

test('provider rejects symlinked captures and damaged stores, while portable studies need no store', async t => {
  const { root } = await fixture(t);
  const capture = join(root, 'jds/china/boss-marketfixture-49d4e6588f04f635cc29.md');
  const moved = `${capture}.real`; writeFileSync(moved, readFileSync(capture)); rmSync(capture); symlinkSync(moved, capture);
  await assert.rejects(() => createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root }), /archive_corrupt/);
  rmSync(capture); writeFileSync(capture, readFileSync(moved));
  rmSync(join(root, 'data/china/store.json'));
  assert.equal((await createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root })).length, 1);
  writeFileSync(join(root, 'data/china/store.json'), '{bad json');
  await assert.rejects(() => createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root }), /store_corrupt/);
});

test('known closed jobs are omitted but blocked observations do not close frozen jobs', async t => {
  const { root } = await fixture(t);
  const storePath = join(root, 'data/china/store.json');
  const state = JSON.parse(readFileSync(storePath));
  state.jobs['boss:marketfixture'].lastAttempt = { status: 'challenge', at: '2026-09-11T00:00:00.000Z' };
  writeFileSync(storePath, JSON.stringify(state));
  assert.equal((await createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root })).length, 1);
  state.jobs['boss:marketfixture'].lastAttempt.status = 'closed';
  writeFileSync(storePath, JSON.stringify(state));
  assert.deepEqual(await createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root }), []);
});

test('a study containing both platforms is partitioned by provider', async t => {
  const root = mkdtempSync(join(tmpdir(), 'two-archive-providers-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const boss = seed(root), state = openStore(root);
  const liepin = recordObservation(root, state, { platform: 'liepin', url: 'https://www.liepin.com/job/12345.shtml',
    title: '平台工程师', company: '另一合成公司', location: '北京', description: `${description} 负责平台稳定性建设。`, status: 'ok', observedAt: '2026-09-10T00:30:00.000Z' });
  saveStore(root, state);
  await prepareStudy(root, options([...boss.selected, { jobKey: liepin.key, contentHash: liepin.latest.hash }]));
  const bossJobs = await createArchiveProvider('boss').fetch({ study_id: 'market-fixture' }, { dataRoot: root });
  const liepinJobs = await createArchiveProvider('liepin').fetch({ study_id: 'market-fixture' }, { dataRoot: root });
  assert.deepEqual(bossJobs.map(job => job.company), ['合成公司']);
  assert.deepEqual(liepinJobs.map(job => job.company), ['另一合成公司']);
  assert.equal(liepinJobs[0].url, 'https://www.liepin.com/job/12345.shtml');
});

test('latest explicit availability wins and a challenge does not erase known closure', async t => {
  const { root, seeded } = await fixture(t);
  const job = seeded.state.jobs['boss:marketfixture'];
  job.availabilityObservations = [{result:'expired',checkedAt:'2026-09-11T00:00:00Z'}];
  job.lastAttempt = {status:'challenge',at:'2026-09-12T00:00:00Z'};
  saveStore(root, seeded.state);
  const fetch = () => createArchiveProvider('boss').fetch({study_id:'market-fixture'},{dataRoot:root});
  assert.deepEqual(await fetch(), []);
  job.availabilityObservations.push({result:'active',checkedAt:'2026-09-12T01:00:00Z'});
  saveStore(root, seeded.state);
  assert.equal((await fetch()).length, 1);
});

test('market provider projection requires the current pool version, ordinary projection remains available',async t=>{
 const {root}=await fixture(t);const provider=createArchiveProvider('boss'),entry={study_id:'market-fixture'};
 const all=await provider.fetch(entry,{dataRoot:root});assert.ok(all.length);
 writeFileSync(join(root,'pool.json'),JSON.stringify({configurationHash:'c',records:[]}));
 assert.deepEqual(await provider.fetch({...entry,market_pool:'pool.json',market_configuration_hash:'c'},{dataRoot:root}),[]);
 await assert.rejects(provider.fetch({...entry,market_pool:'pool.json',market_configuration_hash:'old'},{dataRoot:root}),/configuration/);
});
