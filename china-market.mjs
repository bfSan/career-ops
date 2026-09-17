#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { lstatSync, realpathSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { fingerprint, openStore } from './china/store.mjs';
import { prepareStudy, prepareSourceStudy, readStudy } from './china/market-study.mjs';
import { validateBundle } from './china/market-analysis.mjs';
import { summarize, renderRequirementsCsv } from './china/market-summary.mjs';
import { connectMarket } from './china/market-connections.mjs';
import { loadMarketSelection } from './china/market-workflow.mjs';

const HELP = `Local China market research (no browser, model or personal profile access).
node china-market.mjs prepare --study ID --selection FILE [--schema-version 1|2]
node china-market.mjs prepare --study ID --sources FILE --schema-version 2
node china-market.mjs validate --study ID --file FILE
node china-market.mjs report --study ID --file FILE
node china-market.mjs connect --study ID --file FILE
All commands: --root PATH, --help
Market prepare: --market-pool FILE --configuration-hash HASH (requires reviewed, same-version eligibility)
Exit codes: 0 complete; 2 invalid analysis or partial review; 1 input/runtime error.
`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
export function readJsonLimited(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) throw new Error('JSON input must be a regular file of at most 10 MiB');
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Invalid JSON input'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON input must be an object');
  return value;
}
function checkPath(root, parts) {
  let path = realpathSync(root), missing = false;
  for (const part of parts) {
    path = join(path, part);
    if (missing) continue;
    try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe report directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; }
  }
  return path;
}
const cell = value => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''))
  .replace(/&/g, '&amp;').replace(/[\\`*_[\]{}()#!+~:.@-]/g, char => `&#${char.charCodeAt(0)};`).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r\n|[\r\n]/g, '<br>');
const table = (headers, rows) => {
  const row = values => `| ${values.map(cell).join(' | ')} |`;
  return [row(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row)].join('\n');
};
export function renderMarketReport(study, summary, validation) {
  const salaries = new Map(summary.missingness.salary.jobs.map(job => [job.jobKey, job]));
  const v2=study.manifest.schemaVersion===2;
  return `# China market research: ${cell(summary.studyId)}

Review status: ${summary.complete ? 'complete' : 'partial / incomplete'}; selected jobs: ${summary.jobs}; missing analyses: ${validation.missingJobKeys.length}.
sourceDigest: ${summary.sourceDigest}; analysisDigest: ${summary.analysisDigest}

${v2?'This is a selected convenience sample, not a representative market survey. Only labeled source dates and comparable compensation are used. observedAt is capture time, never publication time. Salary range midpoints are advertised comparisons, not take-home pay.':'This is a selected convenience sample, not a representative market survey. Posting dates were not collected; observedAt is capture time. No numeric salary or posting time is inferred.'}

## Scope and provenance

${table(['cities', 'keywords', 'queryUrls', 'createdAt'], [[study.manifest.scope.cities, study.manifest.scope.keywords, study.manifest.scope.queryUrls, study.manifest.createdAt]])}

${table(['jobKey', 'contentHash', 'capturePath', 'observedAt', 'latestAttempt', 'listingBinding', 'queryRefs'], study.sources.map(s => [s.jobKey, s.contentHash, s.capturePath, s.observedAt, s.latestAttempt, s.listingBinding, s.queryRefs]))}

## Coverage and unknowns

${table(['jobs', 'identifiedJobs', 'distinctCompanies', 'anonymousOrUnknownJobs', 'missingAnalyses', 'salaryReadable', '编码未解析', 'salaryNotProvided', 'postingDate'], [[summary.jobs, summary.companyCoverage.identifiedJobs, summary.companyCoverage.distinctCompanies, summary.companyCoverage.anonymousOrUnknownJobs, validation.missingJobKeys, summary.missingness.salary.readable, summary.missingness.salary.encoded, summary.missingness.salary.notProvided, v2?summary.missingness.postingDate:'not_collected']])}${v2?'\n\n## Evidenced annual compensation\n\n'+table(['currency','basis','period','comparable N','both bounds N','median advertised range midpoint'],summary.compensationGroups.map(g=>[g.currency,g.basis,g.period,g.jobs,g.withBothBounds,g.medianRangeMidpoint]))+'\n\n'+table(['known','not collected','not provided','unresolved'],[[summary.missingness.compensation.known,summary.missingness.compensation.notCollected,summary.missingness.compensation.notProvided,summary.missingness.compensation.unresolved]]):''}

${table(['cityGroup', 'roleFamily', 'dimension', 'jobs', 'reviewed denominator', 'notReviewed', 'reviewedWithoutMention'], summary.missingness.groups.map(g => [g.cityGroup, g.roleFamily, g.dimension, g.jobs, g.reviewed, g.notReviewed, g.reviewedWithoutMention]))}

## Requirement frequencies

${table(['cityGroup', 'roleFamily', 'dimension', 'subject', 'kind', 'count', 'denominator', 'jobKeys'], summary.rows.map(r => [r.cityGroup, r.roleFamily, r.dimension, r.subject, r.kind, r.count, r.denominator, r.jobKeys]))}

## Job details

${table(['jobKey', 'title', 'company', 'location', 'salaryRaw', 'salaryText', 'rawEncoded', 'salaryStatus'], study.sources.map(s => { const salary = salaries.get(s.jobKey); return [s.jobKey, s.fields.title, s.fields.company, s.fields.location, salary.salaryRaw, salary.salaryText, salary.encoded, salary.status]; }))}

## Requirement evidence and logic

${table(['jobKey', 'dimension', 'subject', 'logicPath', 'effectiveNecessity', 'inferred', 'coverage', 'levelRaw', 'practice', 'years', 'languageScenario', 'evidence'], summary.details.map(d => [d.jobKey, d.dimension, d.subject, d.logicPath, d.effectiveNecessity, d.inferred, d.coverage, d.levelRaw, d.practice, [d.minimumYears, d.maximumYears], d.languageScenario, d.evidence]))}

## Conflicts

${table(['jobKey', 'field', 'note', 'evidence'], summary.conflicts.map(c => [c.jobKey, c.field, c.note, c.evidence]))}

Human interpretation belongs in interpretation.md; personal route changes belong in route-delta.md. Original strings remain in JSON/CSV.
`;
}
export async function saveReport(root, study, bundle, summary) {
  if (!validId(study.manifest.studyId)) throw new Error('Invalid studyId');
  if (study.manifest.sourceDigest !== fingerprint({ scope: study.manifest.scope, sources: study.sources })) throw new Error('sourceDigest mismatch');
  const validation = validateBundle(study, bundle);
  if (!validation.valid) throw new Error('Invalid analysis');
  const expected = summarize(study, bundle);
  if (fingerprint(summary) !== fingerprint(expected)) throw new Error('Summary mismatch');
  const analysisDigest = fingerprint(bundle), studyId = study.manifest.studyId;
  
  const files = { 'summary.json': json(summary), 'requirements.csv': renderRequirementsCsv(summary), 'analysis.json': json(bundle), 'validation.json': json(validation), 'market-report.md': renderMarketReport(study, summary, validation) };
  const reportDigest=fingerprint(files);
  const parts=['reports','china-market',studyId,`${analysisDigest}-${reportDigest}`];
  return { studyId, analysisDigest, reportDigest, ...await saveFiles(root, parts, files) };
}
export async function saveFiles(root, parts, files) {
  const reportDir = checkPath(root, parts), leaf = parts.at(-1), parents = parts.slice(0, -1);
  // Validate guard paths before the shared lock implementation touches them.
  checkPath(root, [...parents, `${leaf}.lock`]);
  checkPath(root, [...parents, `${leaf}.lock.recover`]);
  return withPipelineLock(reportDir, async () => {
    checkPath(root, parts);
    let existing = false;
    try { existing = lstatSync(reportDir).isDirectory(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      for (const [name, bytes] of Object.entries(files)) {
        const file = join(reportDir, name), stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size !== Buffer.byteLength(bytes) || readFileSync(file, 'utf8') !== bytes) throw new Error(`Existing report differs: ${name}`);
      }
      return { status: 'reused', reportDir };
    }
    const parent = dirname(reportDir);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temp = mkdtempSync(join(parent, `.${leaf}-`));
    try {
      for (const [name, bytes] of Object.entries(files)) writeFileSync(join(temp, name), bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      checkPath(root, parts);
      renameSync(temp, reportDir);
    } finally { rmSync(temp, { recursive: true, force: true }); }
    return { status: 'created', reportDir };
  });
}
export function renderConnections(snapshot) {
  const s = snapshot.skills;
  const unmapped = new Map();
  for (const d of s.details.filter(d => d.included && !d.skills.length)) {
    const key = JSON.stringify([d.subject, d.mapping]);
    if (!unmapped.has(key)) unmapped.set(key, { subject: d.subject, mapping: d.mapping, jobKeys: new Set(), evidence: d.evidence.quote });
    unmapped.get(key).jobKeys.add(d.jobKey);
  }
  const frequencyTable = rows => table(['技能', '上下文必要性', '提及岗位数', '已审阅分母', '主题恰好为该技能的岗位数', '岗位依据'], rows.map(r => [r.skill, r.kind, r.count, r.denominator, r.exactSubjectJobKeys.length, r.jobKeys]));
  return `# 市场分析链路验收：${cell(snapshot.studyId)}

${snapshot.jobs} 条冻结岗位；语义审阅${snapshot.complete ? '完整' : '尚未完成（partial）'}。这是选定便利样本，不能推算市场招聘总量。

原始逐岗报告：[market-report.md](../../market-report.md)；完整归并、证据与时间记录：[connections.json](connections.json)。

## 已接通的技能汇总

直接复用 career-ops 的 skill-extract.mjs。${s.mappedLeaves}/${s.eligibleLeaves} 个已审阅、非推断的技能叶节点识别出原文也出现的技术名称，共 ${s.distinctSkills} 个名称；${s.unmappedLeaves} 个未归并节点保留原文，${s.excludedLeaves} 个未审阅或推断节点不计数。

下面统计“技能名称提及”，不会将复合主题改写成全部必需技能。required / preferred / unspecified 来自语义节点；alternative 表示任选分支。同一岗位同类只计一次，不同类别可能重叠，不能相加。exact_subject 也只代表主题精确匹配，仍受条件树约束。未识别不等于没有要求，程度和任务表现保留在 JSON 明细。

### 全样本（前 30 行）

${frequencyTable(s.rows.filter(r => r.scope === 'all').slice(0, 30))}

${s.groups.filter(g => g.scope === 'role_family').map(g => `### ${cell(g.roleFamily)}（前 15 行；已审阅 ${g.denominator} 条）\n\n${frequencyTable(s.rows.filter(r => r.scope === 'role_family' && r.roleFamily === g.roleFamily).slice(0, 15))}`).join('\n\n')}

城市 × 岗位方向的完整分组、分母及每条 requirementId/evidence 均在 connections.json；不以城市样本配额比较市场规模。

### 待归并的技能主题（前 30 项）

unmapped 表示原项目词表未识别；unsupported_by_evidence 表示主题识别出的名称未在其证据中匹配到，可能需要审查中文译名或语义拆解，不能直接补计。此处不是个人能力缺口。

${table(['原主题', '原因', '岗位数', '原文例证', '岗位依据'], [...unmapped.values()].sort((a, b) => b.jobKeys.size - a.jobKeys.size).slice(0, 30).map(d => [d.subject, d.mapping, d.jobKeys.size, d.evidence, [...d.jobKeys]]))}

## 时间、薪资与样本质量

${table(['冻结岗位', '薪资可读', '薪资编码未解析', '薪资未提供', '经验等冲突岗位'], [[snapshot.jobs, snapshot.salary.readable, snapshot.salary.encoded, snapshot.salary.notProvided, snapshot.conflicts.jobs]])}

${snapshot.schemaVersion===2?'首次/末次成功采集时间来自 store；发布、更新、有效期分别采用冻结的页面标签证据，缺失与未采集分开。当前可用性未重新验证；完整时间明细在 JSON 的 timeline。':'首次/末次成功采集时间来自 store；冻结时间来自 study。发布日期、平台更新时间、有效期均未采集；当前可用性未重新验证。失败或登录失效不能解释为岗位下架。完整时间明细在 JSON 的 timeline。'}

### 岗位时间台账

${snapshot.schemaVersion===2?'下面的采集记录不代表发布时间；日精度发布事实保留平台时区日期。':'以下均为带时区的采集记录（Z 表示 UTC）；所有岗位的发布日期、平台更新时间和有效期均未知。'}

${table(['岗位', '首次成功采集', '最后成功采集', '最新尝试时间', '最新尝试状态', '冻结版本仍为最新'], snapshot.timeline.map(j => [j.jobKey, j.firstSuccessfullyCapturedAt, j.lastSuccessfullyCapturedAt, j.latestAttempt?.at, j.latestAttempt?.status, j.selectedVersionMatchesLatest]))}${snapshot.schemaVersion===2?'\n\n'+table(['岗位','发布事实','更新事实','有效期'],snapshot.timeline.map(j=>[j.jobKey,j.publishedAt,j.sourceUpdatedAt,j.validThrough]))+'\n\n'+table(['币种','比较口径','可比 N','广告区间中点中位数'],snapshot.compensationGroups.map(g=>[g.currency,g.basis,g.jobs,g.medianRangeMidpoint])):''}

## 后续模块实际缺口

${table(['模块', '状态', '依据与待补输入'], snapshot.modules.map(m => [m.id, m.status, m.reason]))}

本次仅生成离线研究输出。个人能力路线留到市场研究之后；现有学习计划不能当作能力已完成的证据。
`;
}
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean' }, root: { type: 'string' }, study: { type: 'string' }, selection: { type: 'string' }, sources: { type: 'string' }, file: { type: 'string' },'schema-version':{type:'string'},'market-pool':{type:'string'},'configuration-hash':{type:'string'} } });
  if (values.help) { console.log(HELP); return 0; }
  const [command] = positionals;
  if (positionals.length !== 1 || !['prepare', 'validate', 'report', 'connect'].includes(command)) throw new Error('Choose prepare, validate, report or connect');
  if (!validId(values.study)) throw new Error('Invalid studyId');
  if(values['schema-version']!==undefined&&(command!=='prepare'||!['1','2'].includes(values['schema-version'])))throw new Error('--schema-version 1|2 is only valid for prepare');
  if (values.sources && (command!=='prepare'||values.selection||values.file||values['schema-version']!=='2')) throw new Error('--sources requires prepare --schema-version 2 without --selection or --file');
  if (command === 'prepare' ? ((!values.selection&&!values.sources) || values.file) : (!values.file || values.selection || values.sources)) throw new Error('Use --selection or --sources for prepare, or --file for validate/report/connect');
  const root = values.root ? resolve(values.root) : getCareerOpsRoot();
  if ((values['market-pool'] || values['configuration-hash']) && command !== 'prepare') throw new Error('market selection is only valid for prepare');
  const market = loadMarketSelection(root, values['market-pool'], values['configuration-hash']);
  const checkMarket = rows => { if (market && rows.some(r => !market.has(r.jobKey, r.contentHash))) throw new Error('market eligibility missing or source version changed'); };
  if (command === 'prepare') {
    if(values.sources){
      const input=readJsonLimited(values.sources);
      if(Object.keys(input).sort().join(',')!=='scope,sources')throw new Error('Source input accepts only scope and sources');
      checkMarket(input.sources);
      const study=await prepareSourceStudy(root,{...input,studyId:values.study,createdAt:new Date().toISOString(),schemaVersion:2});
      console.log(JSON.stringify(study.manifest));return 0;
    }
    const selection = readJsonLimited(values.selection);
    if (Object.keys(selection).sort().join(',') !== 'scope,selected') throw new Error('Selection accepts only scope and selected');
    checkMarket(selection.selected);
    const study = await prepareStudy(root, { studyId: values.study, createdAt: new Date().toISOString(), ...selection,...(values['schema-version']?{schemaVersion:Number(values['schema-version'])}:{}) });
    console.log(JSON.stringify(study.manifest)); return 0;
  }
  const study = readStudy(root, values.study), bundle = readJsonLimited(values.file);
  const validation = validateBundle(study, bundle);
  if (command === 'validate' || !validation.valid) { console.log(JSON.stringify(validation)); return validation.valid && validation.complete ? 0 : 2; }
  const summary = summarize(study, bundle);
  // Read all connection inputs before publishing anything. No browser or personal profile access.
  const snapshot = command === 'connect' ? connectMarket(study, summary, openStore(root)) : null;
  const result = await saveReport(root, study, bundle, summary);
  if (snapshot) {
    const connectionDigest = fingerprint(snapshot);
    const saved = await saveFiles(root, ['reports', 'china-market', values.study, `${result.analysisDigest}-${result.reportDigest}`, 'connections', connectionDigest], {
      'connections.json': json(snapshot), 'workflow-report.md': renderConnections(snapshot),
    });
    Object.assign(result, { connectionDigest, connectionDir: saved.reportDir, connectionStatus: saved.status });
  }
  console.log(JSON.stringify(result));
  return summary.complete ? 0 : 2;
}
if (isMainModule(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
