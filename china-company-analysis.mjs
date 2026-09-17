#!/usr/bin/env node
// Company × role-family × company-size cross tabulation for the four-city AI market pool.
//
// This is a research output script, not a new market-analysis schema and not part of the
// collection CLI. It reads classification rules from data/china/company-taxonomy.json
// (user-editable) and joins them to the already-published pool, seven-dimension analysis
// and frozen observation facts by jobKey + contentHash. There is deliberately no
// company-specific branch in this file: every bucket assignment lives in the config, so
// editing the config is enough to change a classification.
//
// Evidence tiers follow the market research brief:
//   platform_label  - company size read from the platform company card
//   analyst_judgment- classification of a named display company; legal entity not verified
//   display_claim   - classification inferred from an anonymised display name, which is a
//                     claim in the ad text, not a verified employer identity
import fs from 'node:fs';
import crypto from 'node:crypto';
import { openStore } from './china/store.mjs';

const ROOT = process.cwd();
const D = 'data/china/research/planning/round-20260916-c';
const TAXONOMY_PATH = 'data/china/company-taxonomy.json';
const OUT_MD = `${D}/company-analysis.md`;
const OUT_JSON = `${D}/company-analysis.json`;

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const taxonomy = read(TAXONOMY_PATH);
const pool = read('reports/china-market/current/pool.json');
const analysis = read('reports/china-market/current/analysis.json');
const release = read('reports/china-market/current/release.json');
const store = openStore(ROOT);

const BUCKET_LABEL = new Map(taxonomy.buckets.map((b) => [b.id, b.label]));
const BUCKET_ORDER = taxonomy.buckets.map((b) => b.id);
const SIZE_LABELS = new Map();
for (const b of taxonomy.sizeBuckets) {
  for (const l of b.labels) SIZE_LABELS.set(l, { id: b.id, label: b.label });
}
const SIZE_ORDER = taxonomy.sizeBuckets.map((b) => b.id);
const SIZE_LABEL_OF = new Map(taxonomy.sizeBuckets.map((b) => [b.id, b.label]));

const FAMILY_LABEL = {
  algorithm_model: '模型与算法',
  platform_infra: '平台与基础设施',
  application_agent: '应用与 Agent',
  engineering_solution: '解决方案与交付',
  other_technical: '其他技术（评测/数据等）',
  unknown: '无法判断',
};
const FAMILY_ORDER = ['algorithm_model', 'platform_infra', 'application_agent', 'engineering_solution', 'other_technical', 'unknown'];
const CITIES = ['上海', '杭州', '南京', '福州'];

// An anonymised display name is a claim in the ad text, never a verified employer key.
const ANON = /^(?:某|匿名|保密|未披露|未知|国内某)/;
const MASKED = /某[^，。；]{0,24}(?:公司|集团|企业|单位|银行|研究院|研究所|中心|平台|工作室|事务所)/;
const isAnonymous = (name) => {
  const t = String(name ?? '').trim();
  return ANON.test(t) || MASKED.test(t);
};

const classifications = read('reports/china-market/current/classifications.json');
const channelOf = new Map(classifications.records.map((c) => [c.jobKey, c.channel?.value || 'unknown']));
const famOf = new Map(analysis.records.map((r) => [r.jobKey, r.roleFamily]));
const eligible = pool.records.filter((r) => r.eligibility.value === 'eligible');

const cityOf = (record) => {
  const raw = record.location?.raw || '';
  const hit = CITIES.filter((c) => raw.includes(c));
  if (hit.length) return hit;
  return (record.location?.targetCities || []).length ? record.location.targetCities : ['未判定'];
};

// Monthly CNY ranges only: multi-payment, bonus and day-rate postings are not mixed in.
const monthlyCny = (jobKey) => {
  const c = store.jobs[jobKey]?.lastAttempt?.facts?.compensation;
  if (!c || c.status !== 'parsed') return null;
  if (c.currency !== 'CNY' || c.period !== 'month') return null;
  if (typeof c.min !== 'number' || typeof c.max !== 'number') return null;
  return (c.min + c.max) / 2;
};
const sizeOf = (jobKey) => store.jobs[jobKey]?.latest?.companySizeRaw || null;

const rows = [];
for (const r of eligible) {
  const name = (r.company || '').trim();
  const entry = taxonomy.companies[name];
  const anonymous = isAnonymous(name);
  // Anonymous ads keep an ad-text industry claim on a separate axis; it never becomes a company key.
  const anonClaim = anonymous ? (taxonomy.anonymousDisplayClaims || {})[name]?.industryClaim || null : null;
  // Anonymous ads are counted on their own axis. Their display name is an ad-text claim, so
  //  folding them into a named-company bucket would inflate that bucket with unverified identity.
  const bucket = anonymous ? 'anonymous_display' : (entry ? entry.bucket : 'other_unknown');
  const tier = anonymous ? (anonClaim ? 'display_claim' : 'anonymous') : (entry ? (entry.evidenceTier || 'analyst_judgment') : 'unclassified');
  const sizeRaw = sizeOf(r.jobKey);
  const size = sizeRaw && SIZE_LABELS.has(sizeRaw) ? SIZE_LABELS.get(sizeRaw) : null;
  rows.push({
    jobKey: r.jobKey,
    provider: r.provider,
    company: name,
    anonymous,
    bucket,
    bucketLabel: BUCKET_LABEL.get(bucket) || bucket,
    tier,
    industryClaim: anonClaim,
    sizeRaw,
    sizeId: size ? size.id : null,
    sizeLabel: size ? size.label : null,
    channel: channelOf.get(r.jobKey) || 'unknown',
    family: famOf.get(r.jobKey) || 'unknown',
    cities: cityOf(r),
    salaryMonthlyCny: monthlyCny(r.jobKey),
  });
}

const count = (arr, key) => {
  const m = new Map();
  for (const x of arr) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return m;
};
const median = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
// The brief forbids reporting a group median below five comparable samples.
const MIN_N = 5;
const salaryCell = (jobs) => {
  const vals = rows.filter((r) => jobs.has(r.jobKey) && r.salaryMonthlyCny !== null).map((r) => r.salaryMonthlyCny / 1000);
  return vals.length >= MIN_N ? { n: vals.length, median: +(median(vals)).toFixed(1) } : { n: vals.length, median: null };
};

const byKey = new Map(rows.map((r) => [r.jobKey, r]));
const ids = (pred) => new Set(rows.filter(pred).map((r) => r.jobKey));

const cell = (bucketId, family) => rows.filter((r) => r.bucket === bucketId && r.family === family);
const BUCKET_ORDER_ALL = [...BUCKET_ORDER, 'anonymous_display'];
const bucketRows = BUCKET_ORDER_ALL.map((b) => {
  const rs = rows.filter((r) => r.bucket === b);
  const jobs = new Set(rs.map((r) => r.jobKey));
  return {
    bucket: b,
    label: b === 'anonymous_display' ? '匿名展示名（不可归属公司）' : (BUCKET_LABEL.get(b) || b),
    jobs: jobs.size,
    namedJobs: rs.filter((r) => !r.anonymous).length,
    anonymousJobs: rs.filter((r) => r.anonymous).length,
    displayNames: new Set(rs.map((r) => r.company)).size,
    unclassifiedJobs: rs.filter((r) => r.tier === 'unclassified').length,
    salary: salaryCell(jobs),
    families: Object.fromEntries(FAMILY_ORDER.map((f) => [f, cell(b, f).length])),
  };
}).filter((b) => b.jobs > 0);

const sizeRows = SIZE_ORDER.map((s) => {
  const rs = rows.filter((r) => r.sizeId === s);
  const jobs = new Set(rs.map((r) => r.jobKey));
  return {
    size: s,
    label: SIZE_LABEL_OF.get(s) || s,
    jobs: jobs.size,
    namedJobs: rs.filter((r) => !r.anonymous).length,
    anonymousJobs: rs.filter((r) => r.anonymous).length,
    salary: salaryCell(jobs),
    families: Object.fromEntries(FAMILY_ORDER.map((f) => [f, rs.filter((r) => r.family === f).length])),
    buckets: Object.fromEntries(BUCKET_ORDER_ALL.map((b) => [b, rs.filter((r) => r.bucket === b).length])),
  };
}).filter((s) => s.jobs > 0);

const sizeUnknown = rows.filter((r) => !r.sizeId);
const familyRows = FAMILY_ORDER.map((f) => {
  const rs = rows.filter((r) => r.family === f);
  const jobs = new Set(rs.map((r) => r.jobKey));
  return { family: f, label: FAMILY_LABEL[f] || f, jobs: jobs.size, salary: salaryCell(jobs) };
}).filter((f) => f.jobs > 0);

const topCompanies = [...count(rows, 'company')]
  .map(([name, n]) => {
    const e = taxonomy.companies[name];
    const rs = rows.filter((r) => r.company === name);
    const anonName = isAnonymous(name);
    const bkt = anonName ? 'anonymous_display' : (e ? e.bucket : 'other_unknown');
    return { company: name, jobs: n, anonymous: anonName, bucket: bkt, bucketLabel: bkt === 'anonymous_display' ? '匿名展示名（不可归属公司）' : (BUCKET_LABEL.get(bkt) || bkt), tier: e ? (isAnonymous(name) ? 'display_claim' : e.evidenceTier || 'analyst_judgment') : 'unclassified', sizeRaw: rs.find((r) => r.sizeRaw)?.sizeRaw || null, families: Object.fromEntries(FAMILY_ORDER.map((f) => [f, rs.filter((r) => r.family === f).length])) };
  })
  .sort((a, b) => b.jobs - a.jobs || a.company.localeCompare(b.company));

const taxonomySha256 = crypto.createHash('sha256').update(fs.readFileSync(TAXONOMY_PATH)).digest('hex');
const namedRows = rows.filter((r) => !r.anonymous);
const anonRows = rows.filter((r) => r.anonymous);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  studyId: release.studyId,
  sourceDigest: release.sourceDigest,
  taxonomyPath: TAXONOMY_PATH,
  taxonomyVersion: taxonomy.version,
  taxonomySha256,
  coverage: {
    eligibleJobs: rows.length,
    namedJobs: namedRows.length,
    anonymousJobs: anonRows.length,
    classifiedNamedJobs: namedRows.filter((r) => r.tier !== 'unclassified').length,
    unclassifiedNamedJobs: namedRows.filter((r) => r.tier === 'unclassified').length,
    jobsWithCompanySize: rows.filter((r) => r.sizeId).length,
    jobsWithoutCompanySize: sizeUnknown.length,
    jobsWithMonthlySalary: rows.filter((r) => r.salaryMonthlyCny !== null).length,
    anonymousJobsWithIndustryClaim: anonRows.filter((r) => r.industryClaim).length,
    minGroupSample: MIN_N,
  },
  note: [
    '计数单位为招聘广告，多地点岗位在每城各计一次，岗位总数按广告去重。',
    '公司分类为分析者判断，法人主体未逐家核验；匿名展示名的分类是广告来源声称，不是已核实雇主。',
    '公司规模取平台公司卡片字段，仅猎聘来源提供；缺失保持未知，不按品牌知名度推断。',
    '薪资仅统计同一币种同周期的双边界月薪区间中点，多薪/奖金/日薪不混算；组内样本不足 5 条不报中位数。',
  ],
  buckets: bucketRows,
  sizes: sizeRows,
  sizeUnknown: { jobs: sizeUnknown.length, families: Object.fromEntries(FAMILY_ORDER.map((f) => [f, sizeUnknown.filter((r) => r.family === f).length])) },
  families: familyRows,
  topCompanies,
  rows,
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');

// ---- markdown ----
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '—');
const fmtSal = (s) => (s.median === null ? (s.n ? `样本${s.n}` : '—') : `${s.median}K（n=${s.n}）`);
const out = [];
out.push('# 四城 AI 岗位：公司分类 × 岗位类型 × 公司规模\n');
out.push(`发布版本 \`${release.studyId}\`｜分类配置 \`${taxonomy.version}\`（sha256 \`${taxonomySha256.slice(0, 12)}\`）。\n`);
out.push('计数单位为招聘广告；公司分类为分析者判断，法人主体未逐家核验；匿名展示名的分类属来源声称。薪资只统计同币种双边界月薪区间中点，组内不足 5 条不报中位数。\n');

out.push('## 覆盖与口径\n');
out.push('| 项目 | 数量 |');
out.push('|---|---|');
out.push(`| 有效岗位 | ${report.coverage.eligibleJobs} |`);
out.push(`| 具名展示公司岗位 | ${report.coverage.namedJobs} |`);
out.push(`| 匿名展示公司岗位 | ${report.coverage.anonymousJobs} |`);
out.push(`| 已归类（具名） | ${report.coverage.classifiedNamedJobs} |`);
out.push(`| 未归类（具名） | ${report.coverage.unclassifiedNamedJobs} |`);
out.push(`| 有公司规模来源 | ${report.coverage.jobsWithCompanySize} |`);
out.push(`| 公司规模未知 | ${report.coverage.jobsWithoutCompanySize} |`);
out.push(`| 有可比月薪 | ${report.coverage.jobsWithMonthlySalary} |`);
out.push('');
const provRows = [...new Set(rows.map((r) => r.provider))].map((p) => {
  const rs = rows.filter((r) => r.provider === p);
  return {provider: p, jobs: rs.length, sal: rs.filter((r) => r.salaryMonthlyCny !== null).length, size: rs.filter((r) => r.sizeId).length};
}).sort((a, b) => b.jobs - a.jobs);
out.push('| 来源 | 岗位数 | 有可比月薪 | 有公司规模 |');
out.push('|---|---|---|---|');
for (const p of provRows) out.push(`| ${p.provider} | ${p.jobs} | ${p.sal} | ${p.size} |`);
out.push('');
out.push('公司规模字段只有猎聘来源提供；BOSS 与官网招聘板记录保持未知，因此任何按公司规模的结论只覆盖猎聘样本。官网招聘板不提供薪资，涉及该来源的分类中位数样本很少。\n');

out.push('## 1. 公司分类 × 岗位类型\n');
out.push('分类分母为具名展示公司岗位；匿名展示名不归入任何公司分类，另见表末。\n');
out.push('| 公司分类 | 岗位数 | 其中具名 | 其中匿名 | 不同展示名 | 月薪中位数 | ' + FAMILY_ORDER.map((f) => FAMILY_LABEL[f]).join(' | ') + ' |');
out.push('|---' + '|---'.repeat(5 + FAMILY_ORDER.length) + '|');
for (const b of bucketRows) out.push(`| ${b.label} | ${b.jobs} | ${b.namedJobs} | ${b.anonymousJobs} | ${b.displayNames} | ${fmtSal(b.salary)} | ${FAMILY_ORDER.map((f) => b.families[f] || 0).join(' | ')} |`);
out.push(`| **合计** | **${rows.length}** | ${namedRows.length} | ${anonRows.length} | ${new Set(rows.map((r) => r.company)).size} | — | ${FAMILY_ORDER.map((f) => familyRows.find((x) => x.family === f)?.jobs || 0).join(' | ')} |`);
out.push('');

out.push('## 2. 公司规模 × 岗位类型\n');
out.push('| 公司规模 | 岗位数 | 其中具名 | 其中匿名 | 月薪中位数 | ' + FAMILY_ORDER.map((f) => FAMILY_LABEL[f]).join(' | ') + ' |');
out.push('|---' + '|---'.repeat(4 + FAMILY_ORDER.length) + '|');
for (const s of sizeRows) out.push(`| ${s.label} | ${s.jobs} | ${s.namedJobs} | ${s.anonymousJobs} | ${fmtSal(s.salary)} | ${FAMILY_ORDER.map((f) => s.families[f] || 0).join(' | ')} |`);
out.push(`| 规模未知 | ${report.sizeUnknown.jobs} | — | — | — | ${FAMILY_ORDER.map((f) => report.sizeUnknown.families[f] || 0).join(' | ')} |`);
out.push('');

out.push('## 3. 公司分类 × 公司规模\n');
out.push('| 公司分类 | ' + SIZE_ORDER.map((s) => SIZE_LABEL_OF.get(s)).join(' | ') + ' | 规模未知 |');
out.push('|---' + '|---'.repeat(SIZE_ORDER.length + 1) + '|');
for (const b of bucketRows) {
  const rs = rows.filter((r) => r.bucket === b.bucket);
  out.push(`| ${b.label} | ${SIZE_ORDER.map((s) => rs.filter((r) => r.sizeId === s).length).join(' | ')} | ${rs.filter((r) => !r.sizeId).length} |`);
}
out.push('');

out.push('## 4. 匿名展示名无法归属公司\n');
out.push(`${anonRows.length} 条岗位的展示名是"某…"等形式，不能作为公司身份聚合。它们仍计入岗位类型、城市、薪资等统计，但不进入公司分类与规模归属。${report.coverage.anonymousJobsWithIndustryClaim} 条带行业线索的匿名广告只在 JSON 中保留原始展示名，不推断雇主。\n`);

out.push('## 5. 匿名广告自述行业线索\n');
const claimRows = [...new Set(anonRows.filter((r) => r.industryClaim).map((r) => r.industryClaim))]
  .map((c) => ({claim: c, label: BUCKET_LABEL.get(c) || c, jobs: anonRows.filter((r) => r.industryClaim === c).length}))
  .sort((a, b) => b.jobs - a.jobs);
if (claimRows.length) {
  out.push('| 广告自述线索 | 岗位数 |');
  out.push('|---|---|');
  for (const c of claimRows) out.push(`| ${c.label} | ${c.jobs} |`);
  out.push('');
}
out.push(`以上 ${report.coverage.anonymousJobsWithIndustryClaim} 条只保留广告自述，不推断雇主，也不计入任何公司分类。\n`);

out.push('## 6. 匿名展示名 × 招聘渠道\n');
out.push('匿名展示名与猎头渠道高度重合，这是"具名/匿名"薪资差的主要来源，不能读成匿名公司待遇更好。\n');
const CH_LABEL = {hr:'HR（默认）', headhunter:'猎头/中介代招', official_board:'官方招聘板', unknown:'未知'};
const chRows = [];
for (const anon of [true, false]) {
  for (const ch of ['hr', 'headhunter', 'official_board']) {
    const rs = rows.filter((r) => r.anonymous === anon && r.channel === ch);
    if (!rs.length) continue;
    const jobs = new Set(rs.map((r) => r.jobKey));
    chRows.push({label: (anon ? '匿名' : '具名') + ' × ' + (CH_LABEL[ch] || ch), jobs: jobs.size, salary: salaryCell(jobs)});
  }
}
out.push('| 分组 | 岗位数 | 月薪中位数 |');
out.push('|---|---|---|');
for (const c of chRows) out.push(`| ${c.label} | ${c.jobs} | ${fmtSal(c.salary)} |`);
out.push('');

out.push('## 7. 岗位类型汇总\n');
out.push('| 岗位类型 | 岗位数 | 占比 | 月薪中位数 |');
out.push('|---|---|---|---|');
for (const f of familyRows) out.push(`| ${f.label} | ${f.jobs} | ${pct(f.jobs, rows.length)} | ${fmtSal(f.salary)} |`);
out.push('');

out.push('## 8. 岗位数前十公司（具名）\n');
out.push('| 公司 | 岗位数 | 公司分类 | 证据层级 | 来源规模 | 岗位类型分布 |');
out.push('|---|---|---|---|---|---|');
for (const c of topCompanies.filter((x) => !x.anonymous).slice(0, 10)) out.push(`| ${c.company} | ${c.jobs} | ${c.bucketLabel} | ${c.tier} | ${c.sizeRaw || '未知'} | ${FAMILY_ORDER.filter((f) => c.families[f]).map((f) => `${FAMILY_LABEL[f]} ${c.families[f]}`).join('，')} |`);
out.push('');
out.push(`逐岗分类结果见 \`company-analysis.json\`（${rows.length} 条），分类规则见 \`${TAXONOMY_PATH}\`。\n`);

fs.writeFileSync(OUT_MD, out.join('\n'));
console.log(JSON.stringify({ studyId: release.studyId, taxonomySha256: taxonomySha256.slice(0, 12), ...report.coverage, buckets: bucketRows.length, sizes: sizeRows.length }, null, 1));
