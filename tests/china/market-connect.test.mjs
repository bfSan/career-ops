import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seed, options, analysis } from './fixtures/market-data.mjs';
import { prepareStudy } from '../../china/market-study.mjs';
import { recordObservation, saveStore } from '../../china/store.mjs';

const entry = fileURLToPath(new URL('../../china-market.mjs', import.meta.url));
async function setup(t, extraDescription = '') {
  const root = mkdtempSync(join(tmpdir(), 'market-connect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { state, selected, job } = seed(root);
  if (extraDescription) {
    const updated = recordObservation(root, state, { ...job.latest, platform: job.platform, url: job.url,
      description: job.latest.description + extraDescription, status: 'ok', observedAt: '2026-09-10T00:30:00.000Z' });
    selected[0].contentHash = updated.latest.hash; saveStore(root, state);
  }
  const study = await prepareStudy(root, options(selected));
  const bundle = analysis(study), file = join(root, 'analysis.json');
  const run = (command = 'connect') => {
    writeFileSync(file, JSON.stringify(bundle));
    return spawnSync(process.execPath, [entry, command, '--root', root, '--study', study.manifest.studyId, '--file', file], { encoding: 'utf8', timeout: 10000 });
  };
  return { root, state, study, bundle, run };
}

test('connect reuses the report and publishes a private reproducible evidence index without touching inputs', async t => {
  const f = await setup(t);
  const original = f.run('report'); assert.equal(original.status, 0, original.stderr);
  const reportDir = JSON.parse(original.stdout).reportDir;
  const files = ['analysis.json', 'summary.json', 'requirements.csv', 'market-report.md', 'validation.json'];
  const before = files.map(name => readFileSync(join(reportDir, name)));
  const storeBefore = readFileSync(join(f.root, 'data/china/store.json'));
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.reportDir, reportDir);
  const snapshot = JSON.parse(readFileSync(join(out.connectionDir, 'connections.json')));
  assert.equal(snapshot.jobs, 1);
  assert.equal(snapshot.timeline[0].publishedAt.status, 'not_collected');
  assert.equal(snapshot.timeline[0].availabilityNow, 'not_rechecked');
  assert.equal(snapshot.timeline[0].firstSuccessfullyCapturedAt, '2026-09-10T00:00:00.000Z');
  assert.equal(snapshot.timeline[0].selectedVersionMatchesLatest, true);
  assert.equal(snapshot.modules.find(m => m.id === 'upskill').status, 'deferred');
  const md = readFileSync(join(out.connectionDir, 'workflow-report.md'), 'utf8');
  assert.match(md, /岗位时间台账/);
  assert.match(md, /待归并的技能主题/);
  assert.equal(statSync(join(out.connectionDir, 'connections.json')).mode & 0o077, 0);
  assert.equal(JSON.parse(f.run().stdout).connectionStatus, 'reused');
  assert.deepEqual(readFileSync(join(f.root, 'data/china/store.json')), storeBefore);
  files.forEach((name, i) => assert.deepEqual(readFileSync(join(reportDir, name)), before[i]));
  assert.equal(existsSync(join(f.root, 'data/applications.md')), false);
  assert.equal(existsSync(join(f.root, 'data/pipeline.md')), false);
  writeFileSync(join(out.connectionDir, 'connections.json'), '{}');
  assert.equal(f.run().status, 1);
});

test('upstream aliases in Chinese JDs collapse while umbrella concepts remain unmapped', async t => {
  const f = await setup(t, '熟悉k8s和Kubernetes，具备云平台经验。');
  const record = f.bundle.records[0], template = record.requirements[0];
  record.requirements = ['k8s', 'Kubernetes', '云平台'].map((subject, i) => {
    const start = f.study.sources[0].fields.description.indexOf(subject);
    return { ...structuredClone(template), id: `alias-${i}`, dimension: 'skill', subject, languageScenario: [],
      evidence: { field: 'description', start, end: start + subject.length, quote: subject } };
  });
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(readFileSync(join(JSON.parse(result.stdout).connectionDir, 'connections.json')));
  const rows = snapshot.skills.rows.filter(r => r.scope === 'all');
  assert.equal(rows.length, 1); assert.equal(rows[0].skill, 'Kubernetes'); assert.equal(rows[0].count, 1);
  assert.equal(snapshot.skills.unmappedLeaves, 1);
});

test('skill mentions retain OR, preferences and evidence; aliases deduplicate by job and inferred branches stay out', async t => {
  const f = await setup(t), record = f.bundle.records[0], template = record.requirements[0];
  const make = (id, subject, quote, extra = {}) => {
    const start = f.study.sources[0].fields.description.indexOf(quote); assert.ok(start >= 0);
    return { ...structuredClone(template), id, dimension: 'skill', subject, languageScenario: [],
      evidence: { field: 'description', start, end: start + quote.length, quote }, ...extra };
  };
  record.requirements = [
    make('choice', '至少一门语言', 'Python或Java至少精通一门', { logic: 'any', alternatives: [make('py', 'python', 'Python'), make('java', 'Java', 'Java')] }),
    make('docker', 'docker', 'Docker经验优先', { necessity: 'preferred' }),
    make('docker-repeat', 'Docker经验', 'Docker经验优先', { necessity: 'preferred' }),
    make('unsupported', 'Kubernetes', 'Docker经验优先', { necessity: 'preferred' }),
    make('unknown', '服务设计', '能独立完成服务设计'),
    make('inferred', 'Docker', 'Docker经验优先', { necessity: 'preferred', evidenceTier: 'inferred' }),
  ];
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(readFileSync(join(JSON.parse(result.stdout).connectionDir, 'connections.json')));
  const all = snapshot.skills.rows.filter(r => r.scope === 'all');
  assert.equal(all.find(r => r.skill === 'Python').kind, 'alternative_required');
  assert.equal(all.find(r => r.skill === 'Docker').count, 1);
  assert.equal(all.find(r => r.skill === 'Docker').denominator, 1);
  assert.ok(!all.some(r => r.skill === 'Kubernetes'));
  assert.equal(snapshot.skills.details.find(d => d.requirementId === 'docker-repeat').mapping, 'subject_mentions');
  assert.equal(snapshot.skills.details.find(d => d.requirementId === 'docker').mapping, 'exact_subject');
  assert.equal(snapshot.skills.details.find(d => d.requirementId === 'unsupported').mapping, 'unsupported_by_evidence');
  assert.equal(snapshot.skills.details.find(d => d.requirementId === 'inferred').included, false);
  assert.equal(snapshot.skills.details.find(d => d.requirementId === 'py').evidence.quote, 'Python');
});

test('invalid and partial analysis follow existing validation gates', async t => {
  const f = await setup(t);
  f.bundle.records[0].requirements[0].evidence.quote = 'invented';
  assert.equal(f.run().status, 2); assert.equal(existsSync(join(f.root, 'reports')), false);
  f.bundle = Object.assign(f.bundle, analysis(f.study));
  f.bundle.records[0].coverage.skill = 'not_reviewed';
  const result = f.run(); assert.equal(result.status, 2, result.stderr);
  const out = JSON.parse(result.stdout);
  const snapshot = JSON.parse(readFileSync(join(out.connectionDir, 'connections.json')));
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.skills.reviewedJobs, 0);
});

test('later failed captures create a new snapshot without turning historical capture into current availability', async t => {
  const f = await setup(t), first = f.run(); assert.equal(first.status, 0, first.stderr);
  const old = JSON.parse(first.stdout);
  recordObservation(f.root, f.state, { platform: 'boss', url: 'https://www.zhipin.com/job_detail/marketfixture.html', status: 'login_required', observedAt: '2026-09-12T00:00:00.000Z' });
  saveStore(f.root, f.state);
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout); assert.notEqual(out.connectionDir, old.connectionDir);
  const snapshot = JSON.parse(readFileSync(join(out.connectionDir, 'connections.json')));
  assert.equal(snapshot.timeline[0].latestAttempt.status, 'login_required');
  assert.equal(snapshot.timeline[0].availabilityNow, 'not_rechecked');
  assert.equal(snapshot.timeline[0].lastSuccessfullyCapturedAt, '2026-09-10T00:00:00.000Z');
});

test('backfilled observations use the earliest successful timestamp for the selected content version', async t => {
  const f = await setup(t), job = f.state.jobs[f.study.sources[0].jobKey];
  recordObservation(f.root, f.state, { ...job.latest, platform: job.platform, url: job.url,
    status: 'ok', observedAt: '2026-09-08T00:00:00.000Z' });
  saveStore(f.root, f.state);
  assert.equal(job.versions[0].observedAt, '2026-09-10T00:00:00.000Z');
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(readFileSync(join(JSON.parse(result.stdout).connectionDir, 'connections.json')));
  assert.equal(snapshot.timeline[0].selectedVersionFirstCapturedAt, '2026-09-08T00:00:00.000Z');
  assert.equal(snapshot.timeline[0].lastSuccessfullyCapturedAt, '2026-09-10T00:00:00.000Z');
});

test('a portable frozen study reports missing history as unknown and a corrupt store fails before publishing', async t => {
  const f = await setup(t), store = join(f.root, 'data/china/store.json');
  writeFileSync(store, '{broken');
  assert.equal(f.run().status, 1);
  assert.equal(existsSync(join(f.root, 'reports')), false);
  rmSync(store);
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(readFileSync(join(JSON.parse(result.stdout).connectionDir, 'connections.json')));
  assert.equal(snapshot.inventory.jobs, 0);
  assert.equal(snapshot.timeline[0].storeRecordAvailable, false);
  assert.equal(snapshot.timeline[0].firstSuccessfullyCapturedAt, null);
  assert.equal(snapshot.timeline[0].selectedVersionMatchesLatest, null);
  assert.equal(snapshot.timeline[0].availabilityNow, 'not_rechecked');
  assert.equal(existsSync(store), false);
});

test('concurrent connect calls publish one snapshot and refuse a symlinked connection directory', async t => {
  const f = await setup(t), file = join(f.root, 'analysis.json');
  writeFileSync(file, JSON.stringify(f.bundle));
  const args = [entry, 'connect', '--root', f.root, '--study', f.study.manifest.studyId, '--file', file];
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { timeout: 10000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([run(), run()]);
  results.forEach(r => assert.equal(r.status, 0, r.stderr));
  const outputs = results.map(r => JSON.parse(r.stdout));
  assert.equal(outputs[0].connectionDir, outputs[1].connectionDir);
  assert.deepEqual(outputs.map(o => o.connectionStatus).sort(), ['created', 'reused']);
  const outside = mkdtempSync(join(tmpdir(), 'market-connect-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'sentinel'), 'unchanged');
  const directory = join(outputs[0].reportDir, 'connections');
  rmSync(directory, { recursive: true }); symlinkSync(outside, directory);
  assert.equal(f.run().status, 1);
  assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'unchanged');
  assert.equal(existsSync(join(outside, outputs[0].connectionDigest)), false);
});
