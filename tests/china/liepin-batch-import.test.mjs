import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { importJobs } from '../../china/import.mjs';
import { openStore } from '../../china/store.mjs';
import { envelope } from './liepin-batch-fixture.mjs';

const root = () => mkdtempSync(join(tmpdir(), 'liepin-batch-import-'));

test('complete envelope is validated before import, retains provenance and duplicate envelope is idempotent', async () => {
  const dir = root();
  try {
    const value = envelope({ count: 1 });
    const first = await importJobs(dir, { platform: 'liepin', records: value.records, batchContext: value });
    assert.equal(first.observations, 1);
    assert.equal(first.newVersions, 1);
    assert.equal(first.jobs[0].observedAt, value.records[0].observedAt);
    assert.equal(first.jobs[0].versionCreated, true);
    assert.equal(first.provenance.status, 'validated');
    const second = await importJobs(dir, { platform: 'liepin', records: value.records, batchContext: value });
    assert.equal(second.observations, 0);
    assert.equal(second.newVersions, 0);
    assert.equal(second.idempotent, true);
    const job = Object.values(openStore(dir).jobs)[0];
    assert.equal(job.observations.length, 1);
    assert.equal(job.versions.length, 1);
    assert.equal(job.lastAttempt.source.batchId, value.batch.id);
    assert.equal(job.lastAttempt.source.searchContext.listingHref, value.records[0].searchContext.listingHref);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy arrays remain importable but are insufficient search provenance and cannot establish preview coverage', async () => {
  const dir = root();
  try {
    const value = envelope({ count: 1 });
    const legacy = await importJobs(dir, { platform: 'liepin', records: value.records });
    assert.equal(legacy.provenance.status, 'legacy');
    assert.equal(legacy.provenance.reason, 'insufficient_search_provenance');
    const cli = join(process.cwd(), 'china', 'freshness-plan.mjs');
    const result = spawnSync(process.execPath, [cli, 'preview'], { encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: dir } });
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    const ai = preview.tasks.find(task => task.city === '上海' && task.platform === 'liepin' && task.keyword === 'AI Agent');
    const fde = preview.tasks.find(task => task.city === '上海' && task.platform === 'liepin' && task.keyword === 'FDE');
    assert.equal(ai.validatedBatchAt, null);
    assert.equal(ai.provenance, 'provenance_unknown');
    assert.equal(fde.validatedBatchAt, null);
    assert.equal(fde.provenance, 'provenance_unknown');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid complete envelope is rejected before any data write', async () => {
  const dir = root();
  try {
    const value = envelope({ count: 1 });
    value.records[0].searchContext.city = '杭州';
    await assert.rejects(importJobs(dir, { platform: 'liepin', records: value.records, batchContext: value }));
    assert.equal(existsSync(join(dir, 'data')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
