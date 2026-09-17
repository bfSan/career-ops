import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildStudy, prepareStudy, readStudy } from '../../china/market-study.mjs';
import { fingerprint, openStore, saveStore, recordObservation } from '../../china/store.mjs';
import { seed, options, description } from './fixtures/market-data.mjs';

function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'market-study-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('buildStudy freezes the selected current version without mutating its inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'market-build-'));
  try {
    const { state, selected } = seed(root);
    state.runs.push({ id: 'run-1', searchUrl: 'https://example.invalid/search', startedAt: '2026-09-09T23:00:00.000Z', seen: [selected[0].jobKey] });
    const input = options(selected);
    const before = JSON.stringify({ state, input });
    const study = buildStudy(state, input);
    assert.equal(study.sources[0].fields.description, description);
    assert.equal(study.sources[0].fields.listingText, 'AI应用工程师\n合成公司\n上海\n经验不限');
    assert.deepEqual(study.sources[0].queryRefs, [{ runId: 'run-1', searchUrl: 'https://example.invalid/search', startedAt: '2026-09-09T23:00:00.000Z' }]);
    assert.equal(study.manifest.sourceDigest, fingerprint({ scope: input.scope, sources: study.sources }));
    assert.equal(JSON.stringify({ state, input }), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('study is frozen and refuses an overwrite without modifying source bytes', async t => {
  const root = tempRoot(t);
  const { selected, job } = seed(root);
  const storeFile = join(root, 'data/china/store.json');
  const captureFile = join(root, job.latest.capturePath);
  const before = [readFileSync(storeFile), readFileSync(captureFile)];
  const study = await prepareStudy(root, options(selected));
  assert.equal(study.sources.length, 1);
  assert.deepEqual(readStudy(root, 'market-fixture'), study);
  await assert.rejects(() => prepareStudy(root, options(selected)), /exists/);
  assert.deepEqual(readFileSync(storeFile), before[0]);
  assert.deepEqual(readFileSync(captureFile), before[1]);
});

test('selection validation rejects unsafe ids, empty and duplicate selections, unknown jobs, old hashes, and failed-only jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'market-validation-'));
  try {
    const { state, selected } = seed(root);
    assert.throws(() => buildStudy(state, { ...options(selected), studyId: '../escape' }), /studyId/);
    assert.throws(() => buildStudy(state, options([])), /selected/);
    assert.throws(() => buildStudy(state, options([...selected, ...selected])), /duplicate/);
    assert.throws(() => buildStudy(state, options([{ jobKey: 'boss:missing', contentHash: 'abc' }])), /unknown_job/);
    assert.throws(() => buildStudy(state, options([{ ...selected[0], contentHash: '00000000000000000000' }])), /selected_version_unavailable/);
    const failed = recordObservation(root, state, { platform: 'boss', url: 'https://www.zhipin.com/job_detail/failedfixture.html', status: 'network_error', observedAt: '2026-09-10T00:30:00.000Z' });
    assert.throws(() => buildStudy(state, options([{ jobKey: failed.key, contentHash: 'none' }])), /selected_version_unavailable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildStudy rejects unknown fields, missing scope fields, and non-string scope values', () => {
  const root = mkdtempSync(join(tmpdir(), 'market-options-'));
  try {
    const { state, selected } = seed(root);
    const valid = options(selected);
    const invalid = [
      { ...valid, extra: true },
      { ...valid, scope: { ...valid.scope, extra: [] } },
      { ...valid, scope: { cities: valid.scope.cities, keywords: valid.scope.keywords } },
      { ...valid, scope: { ...valid.scope, cities: [null, {}] } },
      { ...valid, scope: { ...valid.scope, keywords: [42] } },
      { ...valid, scope: { ...valid.scope, queryUrls: [false] } },
      { ...valid, selected: [{ ...selected[0], extra: true }] },
    ];
    for (const input of invalid) assert.throws(() => buildStudy(state, input), /invalid|unknown/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a later failed attempt preserves the historical JD but unbinds newer listing text', async t => {
  const root = tempRoot(t);
  const { state, selected, job } = seed(root);
  recordObservation(root, state, {
    platform: 'boss', url: job.url, status: 'network_error', title: '不应绑定的新标题',
    listingText: '不应绑定的新列表原文', observedAt: '2026-09-10T00:30:00.000Z',
  });
  saveStore(root, state);
  const study = await prepareStudy(root, options(selected));
  assert.deepEqual(study.sources[0].latestAttempt, { status: 'network_error', at: '2026-09-10T00:30:00.000Z' });
  assert.equal(study.sources[0].observedAt, '2026-09-10T00:00:00.000Z');
  assert.equal(study.sources[0].listingBinding, 'unbound');
  assert.equal(study.sources[0].fields.listingText, '');
});

test('prepareStudy rejects missing, traversing, and outside-symlink captures before publication', async t => {
  const root = tempRoot(t);
  const { selected, job } = seed(root);
  rmSync(join(root, job.latest.capturePath));
  await assert.rejects(() => prepareStudy(root, options(selected)), /capture/);
  assert.equal(existsSync(join(root, 'data/china/research/market-fixture')), false);

  const second = tempRoot(t);
  const seeded = seed(second);
  const state = openStore(second);
  state.jobs[seeded.job.key].latest.capturePath = '../../outside.md';
  saveStore(second, state);
  await assert.rejects(() => prepareStudy(second, options(seeded.selected)), /capture/);

  const third = tempRoot(t);
  const thirdSeed = seed(third);
  const outside = join(third, 'outside.md');
  writeFileSync(outside, `**Job ID:** ${thirdSeed.job.id}\n${description}\n`);
  rmSync(join(third, thirdSeed.job.latest.capturePath));
  symlinkSync(outside, join(third, thirdSeed.job.latest.capturePath));
  await assert.rejects(() => prepareStudy(third, options(thirdSeed.selected)), /capture/);
});

test('prepareStudy verifies that the archive contains the full JD and matching job id', async t => {
  const root = tempRoot(t);
  const { selected, job } = seed(root);
  writeFileSync(join(root, job.latest.capturePath), `**Job ID:** wrong-id\n${description}\n`);
  await assert.rejects(() => prepareStudy(root, options(selected)), /archive/);
  assert.equal(existsSync(join(root, 'data/china/research/market-fixture')), false);
});

test('prepareStudy rejects a Job ID with the selected id only as a prefix', async t => {
  const root = tempRoot(t);
  const { selected, job } = seed(root);
  writeFileSync(join(root, job.latest.capturePath), `**Job ID:** ${job.id}-different\n${description}\n`);
  await assert.rejects(() => prepareStudy(root, options(selected)), /archive/);
});

test('prepareStudy rejects escaped research and capture roots before creating an external lock or study', async t => {
  const root = tempRoot(t);
  const { selected } = seed(root);
  const outsideResearch = tempRoot(t);
  mkdirSync(join(root, 'data/china'), { recursive: true });
  symlinkSync(outsideResearch, join(root, 'data/china/research'));
  await assert.rejects(() => prepareStudy(root, options(selected)), /research|path|symlink/);
  assert.equal(existsSync(join(outsideResearch, 'market-fixture')), false);
  assert.equal(existsSync(join(outsideResearch, 'market-fixture.lock')), false);

  const second = tempRoot(t);
  const seeded = seed(second);
  const outsideCaptures = tempRoot(t);
  const captureName = seeded.job.latest.capturePath.split('/').at(-1);
  renameSync(join(second, seeded.job.latest.capturePath), join(outsideCaptures, captureName));
  rmSync(join(second, 'jds/china'), { recursive: true });
  symlinkSync(outsideCaptures, join(second, 'jds/china'));
  const state = openStore(second);
  state.jobs[seeded.job.key].latest.capturePath = join(outsideCaptures, captureName);
  saveStore(second, state);
  await assert.rejects(() => prepareStudy(second, options(seeded.selected)), /capture|symlink/);
});

test('readStudy rejects digest, source file, and manifest-selection tampering without creating paths', async t => {
  const root = tempRoot(t);
  const { selected } = seed(root);
  await prepareStudy(root, options(selected));
  const dir = join(root, 'data/china/research/market-fixture');
  const manifestFile = join(dir, 'manifest.json');
  const originalManifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  writeFileSync(manifestFile, JSON.stringify({ ...originalManifest, sourceDigest: 'tampered' }));
  assert.throws(() => readStudy(root, 'market-fixture'), /sourceDigest/);
  writeFileSync(manifestFile, JSON.stringify(originalManifest));
  const sourcesFile = join(dir, 'source-jobs.json');
  const sources = JSON.parse(readFileSync(sourcesFile, 'utf8'));
  const originalSources = structuredClone(sources);
  sources[0].fields.description += '篡改';
  writeFileSync(sourcesFile, JSON.stringify(sources));
  assert.throws(() => readStudy(root, 'market-fixture'), /sourceDigest/);
  writeFileSync(sourcesFile, JSON.stringify(originalSources));
  writeFileSync(manifestFile, JSON.stringify({ ...originalManifest, selected: [] }));
  assert.throws(() => readStudy(root, 'market-fixture'), /selected/);
  assert.throws(() => readStudy(root, 'absent-study'), /ENOENT|not found|missing/);
  assert.equal(existsSync(join(root, 'data/china/research/absent-study')), false);
});

test('readStudy rejects a whole-study directory symlink that escapes the research root', async t => {
  const root = tempRoot(t);
  const { selected } = seed(root);
  await prepareStudy(root, options(selected));
  const dir = join(root, 'data/china/research/market-fixture');
  const outside = tempRoot(t);
  const moved = join(outside, 'market-fixture');
  renameSync(dir, moved);
  symlinkSync(moved, dir);
  assert.throws(() => readStudy(root, 'market-fixture'), /study|symlink|path/);
});

test('two concurrent publishers produce exactly one immutable study', async t => {
  const root = tempRoot(t);
  const { selected } = seed(root);
  const results = await Promise.allSettled([prepareStudy(root, options(selected)), prepareStudy(root, options(selected))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && /exists/.test(result.reason.message)).length, 1);
  assert.equal(readStudy(root, 'market-fixture').sources.length, 1);
});
