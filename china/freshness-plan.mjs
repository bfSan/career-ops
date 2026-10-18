#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { liepinBatchPolicy } from './liepin-batch-policy.mjs';

const root = getCareerOpsRoot();
const CITIES = ['上海', '杭州', '南京', '福州'];
const PLATFORMS = ['liepin', 'boss'];
const MAX_JOBS_PER_BATCH = 2;
const MIN_INTERVAL_MS = 15000;
const KEYWORDS = ['AI Agent', 'FDE'];

function args(argv) { const out = { _: [] }; for (let i = 0; i < argv.length; i++) { const x = argv[i]; if (x.startsWith('--')) { const [k, v] = x.slice(2).split('=', 2); out[k] = v ?? argv[++i] ?? true; } else out._.push(x); } return out; }
function usage() { console.log(`四城双平台可见扩展保鲜计划（不访问站点、不控制浏览器）

用法：
  node china/freshness-plan.mjs preview
  node china/freshness-plan.mjs build --platform liepin|boss --city 上海 [--keyword "AI Agent"|FDE]
  node china/freshness-plan.mjs import --platform liepin|boss --file /absolute/export.json

约束：每城每平台每关键词最多2条；两条至少15秒；BOSS/猎聘串行；验证立即停止。
`); }
function loadStore() { const p = join(root, 'data', 'china', 'store.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { jobs: {}, runs: [] }; }
function cityOf(location) { return CITIES.find(c => String(location || '').includes(c)) || null; }
function ageDays(iso) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 86400000) : Infinity; }
function loadVerifiedReceipts() {
  const dir = join(root, 'data', 'china', 'imports');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      // Only a complete, successful envelope establishes city/keyword coverage.
      // Legacy arrays/objects and malformed receipts remain unknown.
      if (value?.schemaVersion !== 2 || value?.kind !== 'liepin_visible_batch') continue;
      liepinBatchPolicy.validateReceipt(value);
      out.push({ value, name, path: `data/china/imports/${name}` });
    } catch { /* one bad historical export must not make preview claim coverage */ }
  }
  return out;
}
function latestVerified(receipts, platform, city, keyword) {
  if (platform !== 'liepin') return null;
  const matches = receipts.filter(({ value }) => value.batch.city === city && value.batch.keyword === keyword);
  matches.sort((a, b) => Date.parse(b.value.batch.endedAt) - Date.parse(a.value.batch.endedAt));
  const hit = matches[0];
  if (!hit) return null;
  return {
    validatedBatchAt: hit.value.batch.endedAt,
    receiptId: hit.value.batch.id,
    receipt: hit.value.batch.id,
    receiptPath: hit.path,
    recordCount: hit.value.records.length,
    // This is local browser self-reported evidence, not third-party certification.
    evidence: 'browser_self_reported',
  };
}
function summary() {
  const s = loadStore();
  const rows = [];
  for (const city of CITIES) for (const platform of PLATFORMS) {
    const jobs = Object.values(s.jobs || {}).filter(j => j.platform === platform && cityOf(j.latest?.location) === city && j.latest?.description);
    const latest = jobs.map(j => j.latest?.observedAt || j.lastSeenAt).filter(Boolean).sort().at(-1) || null;
    rows.push({ city, platform, jobs: jobs.length, lastObservedAt: latest, ageDays: Number.isFinite(ageDays(latest)) ? Number(ageDays(latest).toFixed(1)) : null });
  }
  return rows;
}
function preview() {
  const receipts = loadVerifiedReceipts();
  const byPair = new Map(summary().map(row => [`${row.city}\u0000${row.platform}`, row]));
  let order = 0;
  const tasks = [];
  // Coverage is a city×keyword question. A validated Liepin batch is the
  // only admissible evidence for this pair; BOSS remains listed as a planned
  // serial platform but its legacy/raw imports cannot mark the pair complete.
  for (const city of CITIES) for (const keyword of KEYWORDS) {
    const row = byPair.get(`${city}\u0000liepin`) || { city, platform: 'liepin', jobs: 0, lastObservedAt: null, ageDays: null };
    const verified = latestVerified(receipts, 'liepin', city, keyword);
    tasks.push({
      ...row,
      keyword,
      platforms: PLATFORMS,
      order: ++order,
      // latest.location/latest.observedAt describe one job's history only;
      // they are deliberately not used as batch coverage evidence.
      ...(verified || { validatedBatchAt: null, receiptId: null, receipt: null, receiptPath: null, recordCount: null, evidence: null }),
      provenance: verified ? 'validated' : 'provenance_unknown',
      completed: !!verified,
      action: `构建 ${city} / ${keyword} 目标版本（猎聘与BOSS串行）；普通Chrome通过可见输入框搜索并点击城市控件；完成后显式导入完整回执 JSON`,
    });
  }
  console.log(JSON.stringify({ schemaVersion: 2, keyword: KEYWORDS, cities: CITIES, platforms: PLATFORMS, maxJobsPerBatch: MAX_JOBS_PER_BATCH, minIntervalMs: MIN_INTERVAL_MS, serial: true, stopOn: ['challenge', 'login_required', 'navigation_changed', 'blank_page', 'incomplete_jd'], tasks }, null, 2));
}
function validPlatform(x) { if (!PLATFORMS.includes(x)) throw new Error(`platform 必须是 ${PLATFORMS.join('|')}`); return x; }
function validCity(x) { if (!CITIES.includes(x)) throw new Error(`city 必须是 ${CITIES.join('、')}`); return x; }
function build(a) {
  const platform = validPlatform(a.platform), city = validCity(a.city), keyword = String(a.keyword || KEYWORDS[0]);
  if (!KEYWORDS.includes(keyword)) throw new Error(`keyword 必须是 ${KEYWORDS.join(' 或 ')}`);
  // The BOSS builder currently has no keyword parameterization. Refuse FDE
  // rather than report a successful build that silently searched another term.
  if (platform === 'boss' && keyword === 'FDE') throw new Error('BOSS builder 尚未支持 FDE 关键词参数化，已拒绝构建（未假成功）');
  const script = platform === 'liepin' ? 'china/build-liepin-extension.mjs' : 'china/build-extension.mjs';
  const r = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, CAREER_OPS_CITY: city, CAREER_OPS_KEYWORD: keyword }, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(JSON.stringify({ ok: true, platform, city, keyword, maxJobsPerBatch: MAX_JOBS_PER_BATCH, minIntervalMs: MIN_INTERVAL_MS, next: '在对应普通Chrome扩展管理页刷新加载；不要手动拼接结果URL' }, null, 2));
}
function importBatch(a) { const platform = validPlatform(a.platform); if (!a.file) throw new Error('--file 必填'); const file = String(a.file); const r = spawnSync(process.execPath, ['china-jobs.mjs', 'import', '--platform', platform, '--file', file], { cwd: root, stdio: 'inherit' }); process.exit(r.status ?? 1); }
const a = args(process.argv.slice(2)); const command = a._[0] || 'preview';
try { if (command === 'preview') preview(); else if (command === 'build') build(a); else if (command === 'import') importBatch(a); else { usage(); process.exitCode = 1; } } catch (e) { console.error(`freshness-plan: ${e.message}`); process.exitCode = 1; }
