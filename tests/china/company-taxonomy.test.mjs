import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAXONOMY = join(ROOT, 'data/china/company-taxonomy.json');
const REPORT = join(ROOT, 'data/china/research/planning/round-20260916-c/company-analysis.json');
const POOL = join(ROOT, 'reports/china-market/current/pool.json');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ANON = /^(?:某|匿名|保密|未披露|未知|国内某)/;
const MASKED = /某[^，。；]{0,24}(?:公司|集团|企业|单位|银行|研究院|研究所|中心|平台|工作室|事务所)/;

test('taxonomy keeps anonymous display names out of the company map', () => {
  const tax = read(TAXONOMY);
  const leaked = Object.keys(tax.companies).filter((n) => ANON.test(n.trim()) || MASKED.test(n.trim()));
  assert.deepEqual(leaked, [], `anonymous display names must live in anonymousDisplayClaims, found: ${leaked.join(', ')}`);
  assert.ok(tax.anonymousDisplayClaims && typeof tax.anonymousDisplayClaims === 'object');
});

test('taxonomy bucket ids referenced by companies all exist', () => {
  const tax = read(TAXONOMY);
  const ids = new Set(tax.buckets.map((b) => b.id));
  const bad = Object.entries(tax.companies).filter(([, v]) => !ids.has(v.bucket)).map(([n]) => n);
  assert.deepEqual(bad, []);
});

test('taxonomy only classifies companies that exist in the current pool', () => {
  const tax = read(TAXONOMY);
  const pool = read(POOL);
  const names = new Set(pool.records.filter((r) => r.eligibility.value === 'eligible').map((r) => (r.company || '').trim()));
  const stray = Object.keys(tax.companies).filter((n) => !names.has(n));
  assert.deepEqual(stray, [], `taxonomy entries must match the published pool, stray: ${stray.join(', ')}`);
});

test('company analysis report is consistent with the published pool', { skip: !existsSync(REPORT) }, () => {
  const report = read(REPORT);
  const pool = read(POOL);
  const eligible = pool.records.filter((r) => r.eligibility.value === 'eligible').length;
  assert.equal(report.coverage.eligibleJobs, eligible);
  assert.equal(report.rows.length, eligible);
  for (const r of report.rows) {
    assert.ok(r.bucket, `row ${r.jobKey} has no bucket`);
    if (r.anonymous) assert.equal(r.bucket, 'anonymous_display', `anonymous row ${r.jobKey} leaked into ${r.bucket}`);
  }
  for (const b of [...report.buckets, ...report.sizes]) {
    if (b.salary.median !== null) assert.ok(b.salary.n >= report.coverage.minGroupSample, `${b.label || b.size} reported a median from n=${b.salary.n}`);
  }
  for (const b of report.buckets) {
    const rs = report.rows.filter((r) => r.bucket === b.bucket);
    assert.equal(b.jobs, rs.length, `bucket ${b.bucket} total disagrees with rows`);
    const famSum = Object.values(b.families).reduce((a, c) => a + c, 0);
    assert.equal(famSum, b.jobs, `bucket ${b.bucket} family breakdown does not sum to its total`);
  }
});

test('company analysis is reproducible from the checked-in inputs', { skip: !existsSync(REPORT) }, () => {
  const before = readFileSync(REPORT, 'utf8');
  execFileSync(process.execPath, ['china-company-analysis.mjs'], { cwd: ROOT, stdio: 'pipe' });
  const after = readFileSync(REPORT, 'utf8');
  const strip = (s) => JSON.stringify({ ...JSON.parse(s), generatedAt: null });
  assert.equal(strip(after), strip(before), 're-running the report script changed the classification output');
});
