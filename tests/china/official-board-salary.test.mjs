import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {salaryFiguresIn, qualitativePayPhrasesIn} from '../../data/china/research/planning/round-20260916-c/official-board-salary-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUDY = join(ROOT, 'data/china/research/four-city-round-20260916-c-r1177/source-jobs.json');
const SUMMARY = join(ROOT, 'reports/china-market/current/summary.json');

test('the salary detector recognises real pay shapes', () => {
  for (const text of ['薪资：30-50K·13薪', '待遇 15-20K', '30-50K·16薪', '工资 8000-12000元', '日薪 800-1200元', '薪资30W-50W', '月薪 25-40K', '年薪 40-60万']) {
    assert.ok(salaryFiguresIn(text).length > 0, text);
  }
});

test('the salary detector does not read scale words in this corpus as pay', () => {
  // These decoys all appear in the real official-board JDs. A permissive rule
  // that treats any number-with-unit as salary would misread every one of them.
  for (const text of ['数千万 DAU 用户', '十万卡集群的稳定性', '长上下文推理（128K+）', '数万元算力白白消耗', '500万次调用', '服务千万日活用户']) {
    assert.deepEqual(salaryFiguresIn(text), [], text);
  }
});

test('official-board postings carry no salary figure, so they stay not-provided', {skip: !existsSync(STUDY)}, () => {
  const official = JSON.parse(readFileSync(STUDY, 'utf8')).filter((s) => /^(feishu-jobs|mokahr):/.test(s.jobKey));
  assert.ok(official.length > 0, 'expected official-board postings in the frozen study');

  const flagged = official.filter((s) => {
    const text = [s.fields?.title, s.fields?.description, s.fields?.listingText].filter((v) => typeof v === 'string').join('\n');
    return salaryFiguresIn(text).length > 0;
  });
  assert.deepEqual(flagged.map((s) => s.jobKey), [], 'a new numeric salary figure appeared — revisit the JD-text rule decision');

  // No compensation fact may be invented for a source that never exposes pay.
  for (const s of official) assert.equal(s.facts?.compensation, null, s.jobKey);
});

test('qualitative pay promises are recorded but never parsed as money', {skip: !existsSync(STUDY)}, () => {
  const official = JSON.parse(readFileSync(STUDY, 'utf8')).filter((s) => /^(feishu-jobs|mokahr):/.test(s.jobKey));
  const phrases = official.flatMap((s) => qualitativePayPhrasesIn([s.fields?.description, s.fields?.listingText].join('\n')));
  assert.ok(phrases.some((p) => /竞争力/.test(p)), 'expected the known "有竞争力的薪酬" phrasing to be detected');
  for (const p of phrases) assert.deepEqual(salaryFiguresIn(p), [], p);
});

test('the published market summary labels exactly the official-board jobs as not-provided', {skip: !existsSync(SUMMARY) || !existsSync(STUDY)}, () => {
  const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
  const official = JSON.parse(readFileSync(STUDY, 'utf8')).filter((s) => /^(feishu-jobs|mokahr):/.test(s.jobKey));
  assert.equal(summary.salaryText.notProvided, official.length, 'not-provided count must equal the official-board job count, not a collection gap');
});
