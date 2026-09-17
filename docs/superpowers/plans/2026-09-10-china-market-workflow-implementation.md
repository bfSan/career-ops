# 四城 AI 技术岗位市场研究 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户已于本会话认可并授权执行；当前开始实施，进度见本计划勾选及执行记录。Git 提交、投递、消息发送及思源写回不在本次范围。

**Goal:** 在career-ops现有工作流中完成上海、杭州、南京、福州AI技术岗位的采集、要求拆解与可追溯统计；能力路线校准按用户最新要求最后可选。

**Architecture:** 第一阶段通过现有 `modes/_custom.md` 组织研究，复用BOSS采集、oferta的JD侧分析及既有个人能力/反馈模式。4条样本验证后，增加只负责冻结输入、引用校验、确定性计数和导出的轻量Node工具；不新建评分引擎、数据库服务、MCP或模型调用服务。原始JD、市场分析和个人结论分层保存。

**Tech Stack:** Node >=18、ES modules、node:test、既有Chrome原生采集器、JSON、Markdown、CSV；现有Codex完成语义分析。

**Spec:** `docs/superpowers/specs/2026-09-10-china-market-research-design.md`。

**Research runbook:** `docs/superpowers/plans/2026-09-10-china-market-study.md`。该文件负责实际采样和研究步骤；本文件是实施顺序与软件接口的主计划。

**Personal scope:** `{DATA_ROOT}/data/china/research/planning/market-research-brief.md`。个人来源、四城范围、预算和后续变更均以此及用户最新指示为准。

## Global Constraints

- Node >=18、ES modules、现有依赖；不增加运行时依赖。
- BOSS沿用专用Chrome、原生driver、15秒操作间隔；不安装扩展、不复制日常Chrome Cookie。
- 验证、登录或页面异常时停止该批次，不循环刷新或自动切换浏览器方案。
- 采集原文不可改写；每条分析绑定 `jobKey + contentHash`，采集日期不替代发布日期。
- 市场要求提取不读取CV、不按候选人能力预筛、不投递、不沟通、不自动queue。
- 所有研究数据和个人内容放在Data Root的 `data/`、`reports/` 或 `documents/`。
- 第一轮市场统计只计算有原文证据的完整JD；缺失、推测、未完成提取不能作为“没有要求”。
- 用户已授权实施与有界采样；不创建定时任务、不提交 Git、不写入思源、不自动投递。

进入执行阶段后，最后一条改由该次用户授权决定。不要把研究执行授权扩展为自动投递或发送消息。

## 一、实施范围与复用清单

| 工作 | 复用点 | 本期新增 |
|---|---|---|
| 启动工作流 | `_custom.md` Custom Workflows | 一个“市场岗位研究”流程 |
| 采集 | `china-jobs.mjs scan/list`、`china/collector.mjs`、native driver | 查询清单与批次记录，无新浏览器实现 |
| 数据根与写入 | `getCareerOpsRoot`、`fingerprint`、`atomicPrivateWrite`、`withPipelineLock` | 冻结研究输入，不修改岗位store |
| 语义拆解 | `modes/oferta.md` Block B第一遍、原文证据规范 | 英语/年限/程度/AND-OR/冲突的研究扩展字段 |
| 市场统计 | 没有可直接替代的上游模块 | 少量离线校验、分组计数、CSV/JSON输出 |
| 能力路线 | `intake`、`upskill`模式、个人配置层 | 市场证据与现有路线的差异说明 |
| 后续求职反馈 | tracker、outcome、interview/debrief、patterns、calibrate | 本期不改 |

`upskill.mjs`读取个人评分报告与tracker，不能拿它的低匹配加权结果冒充市场频次。市场侧不填虚假的match、score或申请状态。进入个人评价时再由正常oferta流程生成标准报告和Machine Summary。

## 二、阶段与依赖

```text
Task 1：_custom工作流 + 4条人工样表
  → Task 2：冻结样本与来源
  → Task 3：分析数据与证据校验
  → Task 4：统计和CSV
  → Task 5：薄CLI及集成验收
  → Task 6：四城20条 → 60条实际研究
  → Task 7：能力路线校准（用户最新指示：最后可选，本轮延后）
```

Task 1首先交付可读结果。Task 2–5在字段经4条样本验证后固化；若样本分析暴露分类问题，先改字段和样表再写工具。日期与薪资采集增强、猎聘真实JD验收、看板和周期任务分别另立实施计划，不作为岗位要求报告的前置条件。

## 三、文件边界

| 路径 | 责任 |
|---|---|
| `modes/_custom.md` | 命名工作流及复用原有模式的顺序，保留原内容 |
| `docs/CHINA_MARKET.md` | 研究schema、原文证据、统计口径与命令使用 |
| `china/market-study.mjs` | 冻结选定岗位、校验归档、保存/读取研究输入 |
| `china/market-analysis.mjs` | 校验分析结构、版本绑定、证据及条件树 |
| `china/market-summary.mjs` | 纯函数统计、CSV渲染，无模型或文件访问 |
| `china-market.mjs` | prepare/validate/report薄入口，只做参数与I/O编排 |
| `tests/china/market-*.test.mjs` | 各模块与CLI的回归测试，全部使用合成岗位和临时目录 |
| `tests/china/fixtures/market-data.mjs` | 小型合成岗位及分析构造器 |
| `package.json`、`config/local-paths.txt` | 加入命令别名和fork新增根脚本保护 |
| `docs/CHINA_JOBS.md` | 补充采集到研究的使用链接 |

除工作流引用外，不改 `modes/oferta.md`、`modes/_shared.md`、`upskill.mjs` 或上游评分规则。研究结果继续使用spec定义的data/reports目录，不建立第二份申请tracker。

## 四、固定数据接口

第一版采用以下接口；字段变更先改文档、样表和测试，再改消费者。

```ts
type Evidence = { field: 'description' | 'listingText' | 'location' | 'company'; start: number; end: number; quote: string };
type Dimension = 'experience' | 'language' | 'skill' | 'education' | 'delivery' | 'domain' | 'work_conditions';
type Family = 'application_agent' | 'platform_infra' | 'algorithm_model' | 'engineering_solution' | 'other_technical' | 'unknown';
type CityGroup = string; // scope.cities中的值，或multiple/remote/unknown/conflict/outside_scope
type Requirement = {
  id: string; dimension: Dimension; subject: string;
  necessity: 'required' | 'preferred' | 'unspecified';
  evidenceTier: 'stated' | 'structural' | 'inferred'; evidence: Evidence;
  levelRaw: string | null; practice: string[];
  minimumYears: number | null; maximumYears: number | null;
  languageScenario: ('reading' | 'writing' | 'meeting' | 'customer' | 'certificate' | 'unspecified')[];
  logic: 'single' | 'any' | 'all'; alternatives: Requirement[];
};
type SourceJob = {
  jobKey: string; contentHash: string; capturePath: string; observedAt: string;
  latestAttempt: {status: string; at: string}; listingBinding: 'same_observation' | 'unbound';
  fields: object; // 完整latest内容，去除hash/capturePath/observedAt，再附listingText
  queryRefs: {runId: string; searchUrl: string; startedAt: string}[];
};
type Study = {
  manifest: {schemaVersion: 1; studyId: string; createdAt: string; sourceDigest: string;
    scope: {cities: string[]; keywords: string[]; queryUrls: string[]};
    selected: {jobKey: string; contentHash: string}[]};
  sources: SourceJob[];
};
type JobAnalysis = {
  jobKey: string; contentHash: string; analysisVersion: 'market-v1'; analyzedAt: string;
  roleFamily: Family; roleFamilyEvidence: Evidence | null;
  cityGroup: CityGroup; cityEvidence: Evidence[];
  companyKey: string | null; companyEvidence: Evidence | null;
  coverage: Record<Dimension, 'reviewed' | 'not_reviewed'>;
  requirements: Requirement[];
  conflicts: {field: string; evidence: Evidence[]; note: string}[];
};
type AnalysisBundle = {schemaVersion: 1; studyId: string; sourceDigest: string; records: JobAnalysis[]};
type Validation = {valid: boolean; complete: boolean; errors: {jobKey: string | null; path: string; code: string}[];
  missingJobKeys: string[]; unreviewed: {jobKey: string; dimension: Dimension}[]};
type Summary = {schemaVersion: 1; studyId: string; sourceDigest: string; analysisDigest: string;
  complete: boolean; jobs: number; companyCoverage: object; missingness: object;
  rows: {cityGroup: string; roleFamily: Family; dimension: Dimension; subject: string;
    kind: 'required' | 'preferred' | 'unspecified' | 'alternative_required' | 'alternative_preferred' | 'alternative_unspecified';
    count: number; denominator: number; jobKeys: string[]}[];
  details: object[]; conflicts: object[]};
```

要求节点的证据仅接受description/listingText；location与company用于城市/雇主元数据引用。companyEvidence可来自company/listingText/description；匿名雇主companyKey必须null，不能合并“某大型公司”。城市证据仅来自location/description/listingText，不能由queryRefs或公司名称推断。sourceDigest固定为fingerprint({scope,sources})，研究范围变化也会使旧分析失效。

该schema是研究扩展，不声称被upskill或标准Machine Summary直接消费。科目名称仅做NFKC、大小写、空白归一化；不自动把LangGraph合并成LangChain。需要语义同义归并时先固定映射并记录分析版本。

## Task 1：配置已有工作流，先产出4条样表

**Files:** Modify `modes/_custom.md`；Create `docs/CHINA_MARKET.md`；执行时创建private study输出。

**Interfaces:** Consumes现有4条完整JD及spec；Produces本节四个接口定义、4条逐岗样表和人工复核记录。此任务不写新运行时模块。

- [x] **Step 1：读取当前工作区状态。** 执行 `git status --short` 和 `node china-jobs.mjs list --platform boss`，记录实际岗位数。当前分支存在大量先前未提交改动，不reset、不整体stage。需要提交时仅在用户授权后选择本任务文件/差异。
- [x] **Step 2：向Custom Workflows追加以下内容。** 保留其余个人规则；将本计划数据接口及spec规则整理进 `docs/CHINA_MARKET.md`。

```markdown
### 市场岗位研究

读取 data/china/research/planning/market-research-brief.md 和 docs/CHINA_MARKET.md。
按本轮范围使用 china-jobs 的既有采集/归档；市场分析直接读取冻结JD。
复用 oferta Block B第一遍的JD要求和证据分析，完整保留要求与条件关系。
市场阶段不读取CV，不生成个人评分、简历或申请tracker记录。
逐岗分析后校验证据，再按城市/职责方向统计，输出Markdown报告与CSV。
市场报告完成后，再对照用户确认的能力证据和旧路线；此阶段复用intake/upskill规则。
只在进入个人求职评价阶段时调用原有pipeline/oferta/tracker/反馈流程。
```

- [x] **Step 3：读取4条真实原文并生成样表。** 输出到 `data/china/research/boss-market-pilot-v1/`；先用研究runbook中的冻结步骤。每条要求按本计划接口填写，保留原文、程度、年限类型、英语场景、必需/加分、AND/OR和矛盾。
- [x] **Step 4：逐条人工核对。** 必须核对：列表不限但正文3年；列表3–5年但正文至少1年；至少一门语言；框架或类似系统；Docker/K8s优先；英语未提及；架构落地要求。不能借用户能力调整岗位要求的重要程度。
- [x] **Step 5：固定schema并形成4条样表报告。** 语义问题先修规则和样表再进入Task 2。文档引用检查即可，不为本任务编写模仿Markdown内容的单元测试。

验收：用户可以直接看到详细要求分析；没有新浏览器访问、个人评分或虚构英语/薪资结论。

## Task 2：冻结样本，保持原始证据和来源

**Files:** Create `china/market-study.mjs`、`tests/china/market-study.test.mjs`、`tests/china/fixtures/market-data.mjs`。

**Interfaces:**

```ts
buildStudy(state: object, options: {studyId: string; scope: Study['manifest']['scope']; selected: {jobKey: string; contentHash: string}[]; createdAt: string}): Study;
prepareStudy(root: string, options: Parameters<typeof buildStudy>[1]): Promise<Study>;
readStudy(root: string, studyId: string): Study;
```

`buildStudy`为纯函数；prepareStudy使用read-only store快照、验证归档、写manifest/source-jobs；readStudy验证sourceDigest并返回Study。studyId严格匹配 `^[a-z0-9][a-z0-9-]{0,63}$`，拒绝空选取、重复jobKey、未知岗位、无完整正文和当前hash不符。

- [x] **Step 1：创建共享合成输入构造器并写失败测试。** helper只含合成岗位，不复制私人JD。

```js
// tests/china/fixtures/market-data.mjs
import {recordObservation,openStore,saveStore} from '../../../china/store.mjs';
export const description='要求具备三年以上后端开发经验，能独立完成服务设计。Python或Java至少精通一门；Docker经验优先。英语用于阅读技术文档。';
export function seed(root){
 const state=openStore(root);
 const job=recordObservation(root,state,{platform:'boss',url:'https://www.zhipin.com/job_detail/marketfixture.html',
  title:'AI应用工程师',company:'合成公司',location:'上海',description,status:'ok',
  listingText:'AI应用工程师\n合成公司\n上海\n经验不限',observedAt:'2026-09-10T00:00:00.000Z'});
 saveStore(root,state);return {state,selected:[{jobKey:job.key,contentHash:job.latest.hash}]};
}
export function options(selected){return {studyId:'market-fixture',scope:{cities:['上海'],keywords:['AI'],queryUrls:[]},selected,createdAt:'2026-09-10T01:00:00.000Z'};}
```

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareStudy,readStudy} from '../../china/market-study.mjs';
import {seed,options} from './fixtures/market-data.mjs';
test('study is frozen and refuses an overwrite',async t=>{
 const root=mkdtempSync(join(tmpdir(),'market-study-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {selected}=seed(root),before=readFileSync(join(root,'data/china/store.json'),'utf8');
 const study=await prepareStudy(root,options(selected));
 assert.equal(study.sources.length,1);
 assert.deepEqual(readStudy(root,'market-fixture'),study);
 await assert.rejects(()=>prepareStudy(root,options(selected)),/exists/);
 assert.equal(readFileSync(join(root,'data/china/store.json'),'utf8'),before);
});
```

- [x] **Step 2：运行失败测试。** `node --test tests/china/market-study.test.mjs`；预期新模块不存在或函数未实现。
- [x] **Step 3：实现纯函数与I/O。** 以下是冻结核心，置于已验证参数的buildStudy内部；复用既有fingerprint，不重写哈希算法。

```js
const sources=options.selected.map(({jobKey,contentHash})=>{
 const job=state.jobs[jobKey];
 if(!job?.latest||job.latest.hash!==contentHash)throw new Error('selected_version_unavailable');
 const {hash,capturePath,observedAt,...content}=job.latest;
 if(fingerprint(content)!==hash)throw new Error('content_hash_mismatch');
 const same=job.lastAttempt.status==='ok'&&job.lastAttempt.hash===hash&&job.lastAttempt.at===observedAt;
 return {jobKey,contentHash:hash,capturePath,observedAt,latestAttempt:{status:job.lastAttempt.status,at:job.lastAttempt.at},
  listingBinding:same?'same_observation':'unbound',
  fields:{...structuredClone(content),listingText:same?(job.latestListing?.listingText||''):''},
  queryRefs:state.runs.filter(r=>r.seen.includes(jobKey)).map(r=>({runId:r.id,searchUrl:r.searchUrl,startedAt:r.startedAt}))};
}).sort((a,b)=>a.jobKey.localeCompare(b.jobKey));
const manifest={schemaVersion:1,studyId:options.studyId,createdAt:options.createdAt,
 scope:structuredClone(options.scope),selected:sources.map(({jobKey,contentHash})=>({jobKey,contentHash})),sourceDigest:fingerprint({scope:options.scope,sources})};
return {manifest,sources};
```

prepareStudy先完成所有数据/路径/归档校验，再在最终study路径加 `withPipelineLock`。用同级临时目录写入0600文件、0700目录，最终rename为study目录；已存在即拒绝，失败只清理本次临时目录。capturePath经resolve/realpath检查必须在Data Root的jds/china内部，且归档包含完整正文与对应Job ID。不可读取浏览器目录。readStudy只读，不创建目录；source-jobs篡改或manifest选取关系不符时拒绝。

- [x] **Step 4：补充回归并通过。** 篡改sourceDigest、路径穿越/目录外symlink、重复选择、失败岗位、旧hash、最新尝试失败但保留历史完整JD、缺归档、并发prepare只成功一次。历史JD可入研究，但必须保留最新状态及原观察时间；无法绑定的listingText不得与其合成同次原文。
- [x] **Step 5：验证。** `node --test tests/china/market-study.test.mjs`，所有断言通过且store/原JD字节不变。记录本任务diff；提交仅在用户授权后进行。

## Task 3：校验版本、引用与要求逻辑

**Files:** Create `china/market-analysis.mjs`、`tests/china/market-analysis.test.mjs`；扩充共享fixture。

**Interfaces:**

```ts
validateBundle(study: Study, bundle: AnalysisBundle): Validation;
checkEvidence(source: SourceJob, evidence: Evidence): boolean;
```

函数均为纯函数，不读文件、不调用模型。valid=false阻止统计；valid=true且complete=false表示覆盖未审阅完，允许明确标记为partial的预览。遗漏/重复岗位、未知岗位、错误digest或hash是错误，不是partial。coverage存在not_reviewed时complete=false。

- [x] **Step 1：为fixture加入分析构造器。** 该函数只创建“英语阅读”一项的合成有效记录；其他维度reviewed且无条目用于测试，不作为真实提取方式。

```js
export function analysis(study){
 const source=study.sources[0],quote='英语用于阅读技术文档',start=source.fields.description.indexOf(quote);
 return {schemaVersion:1,studyId:study.manifest.studyId,sourceDigest:study.manifest.sourceDigest,records:[{
  jobKey:source.jobKey,contentHash:source.contentHash,analysisVersion:'market-v1',analyzedAt:'2026-09-10T02:00:00.000Z',
  roleFamily:'unknown',roleFamilyEvidence:null,cityGroup:'unknown',cityEvidence:[],companyKey:null,companyEvidence:null,
  coverage:Object.fromEntries(['experience','language','skill','education','delivery','domain','work_conditions'].map(d=>[d,'reviewed'])),
  requirements:[{id:'r1',dimension:'language',subject:'英语阅读',necessity:'required',evidenceTier:'stated',
   evidence:{field:'description',start,end:start+quote.length,quote},levelRaw:null,practice:[],minimumYears:null,maximumYears:null,
   languageScenario:['reading'],logic:'single',alternatives:[]}],conflicts:[]}]};
}
```

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,options,analysis} from './fixtures/market-data.mjs';
import {buildStudy} from '../../china/market-study.mjs';
import {validateBundle} from '../../china/market-analysis.mjs';
test('exact evidence passes; changed quote and another version fail',t=>{
 const root=mkdtempSync(join(tmpdir(),'market-validation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {state,selected}=seed(root),study=buildStudy(state,options(selected)),bundle=analysis(study);
 assert.equal(validateBundle(study,bundle).valid,true);
 bundle.records[0].requirements[0].evidence.quote='英语流利';
 assert.equal(validateBundle(study,bundle).valid,false);
 const wrong=analysis(study);wrong.records[0].contentHash='00000000000000000000';
 assert.equal(validateBundle(study,wrong).valid,false);
});
```

- [x] **Step 2：运行失败测试。** `node --test tests/china/market-analysis.test.mjs`。
- [x] **Step 3：实现引用检查核心及枚举验证。** 错误返回固定code和字段path，不输出输入全文。

```js
export function checkEvidence(source,e){
 if(!e||!['description','listingText','location','company'].includes(e.field))return false;
 if(e.field==='listingText'&&source.listingBinding!=='same_observation')return false;
 const raw=source.fields[e.field];
 return typeof raw==='string'&&typeof e.quote==='string'&&e.quote.trim().length>0&&
  Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>e.start&&e.end<=raw.length&&
  raw.slice(e.start,e.end)===e.quote;
}
```

校验全部类型和枚举；id全岗位唯一；single必须无alternatives，any/all至少2个子项，嵌套最多8层、每岗总节点最多500；所有节点均需证据。年限为null或0–80有限数，min≤max。inferred不能required；inferred事实不参与统计。非unknown岗位分类需原文证据；城市只允许scope城市或五个特殊组，除unknown外必须有证据。公司不明确时companyKey=null。冲突至少两段有效证据；不得仅写一句结论。未识别枚举、额外字段和缺字段均报错。

引用检查只证明文字存在，不证明必要性、程度或分类的语义正确。人工审阅仍负责“精通”被引用但是否断章取义，以及AND/OR是否符合句意。

- [x] **Step 4：增加测试并通过。** 覆盖重复/缺失岗位、未审阅维度、错field/offset、中文索引、空引用、父子重复id、非法树、超过层数、负/倒置年限、无来源城市、未绑定列表、推断硬要求和空冲突。缺英语条目与未审阅英语必须产生不同结果。
- [x] **Step 5：运行。** `node --test tests/china/market-analysis.test.mjs`；再将Task 1真实4条分析交给新校验器，纠正格式不改原文，并人工确认覆盖。

## Task 4：确定性统计与可筛选CSV

**Files:** Create `china/market-summary.mjs`、`tests/china/market-summary.test.mjs`。

**Interfaces:**

```ts
collectLeaves(requirements: Requirement[]): {requirement: Requirement; alternative: boolean; necessity: Requirement['necessity']}[];
summarize(study: Study, bundle: AnalysisBundle): Summary;
renderRequirementsCsv(summary: Summary): string;
```

summarize内部先validateBundle，valid=false抛出 `invalid_analysis`，不接受调用者伪造的“已校验”标记。输出排序固定：cityGroup、roleFamily、dimension、subject、kind；jobKeys按字典序。源数据和bundle均不修改。

- [x] **Step 1：写失败测试。** 复用Task 2/3 fixture，追加同技能重复、备选、加分和未审阅案例。以下断言针对重复提及；其他用同一构造器创建独立输入。

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,options,analysis} from './fixtures/market-data.mjs';
import {buildStudy} from '../../china/market-study.mjs';
import {summarize} from '../../china/market-summary.mjs';
test('repeated mentions count one job; unreviewed dimension is not a negative',t=>{
 const root=mkdtempSync(join(tmpdir(),'market-summary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {state,selected}=seed(root),study=buildStudy(state,options(selected)),bundle=analysis(study);
 bundle.records[0].requirements.push({...structuredClone(bundle.records[0].requirements[0]),id:'r2'});
 let result=summarize(study,bundle);
 assert.equal(result.rows[0].count,1);assert.equal(result.rows[0].denominator,1);
 bundle.records[0].coverage.language='not_reviewed';result=summarize(study,bundle);
 assert.equal(result.complete,false);assert.equal(result.rows.length,0);
});
```

- [x] **Step 2：运行失败测试。** `node --test tests/china/market-summary.test.mjs`。
- [x] **Step 3：实现条件树折叠。** 根节点无默认必要性；父节点preferred会限制所有子节点；子节点unspecified继承父节点必要性，父节点unspecified不抹去子节点明确必要性。任一祖先inferred时整个分支不计事实频次；任一祖先any时叶子标记alternative。all的叶子分别计数；保留原树供明细查看。

```js
export function collectLeaves(nodes){
 const leaves=[];
 const visit=(node,ctx)=>{
  if(ctx.inferred||node.evidenceTier==='inferred')return;
  const necessity=ctx.necessity==='preferred'||node.necessity==='preferred'?'preferred':
   node.necessity==='unspecified'?(ctx.necessity||'unspecified'):node.necessity;
  const next={alternative:ctx.alternative||node.logic==='any',necessity,inferred:false};
  if(node.logic==='single')leaves.push({requirement:node,alternative:next.alternative,necessity});
  else for(const child of node.alternatives)visit(child,next);
 };
 for(const node of nodes)visit(node,{alternative:false,necessity:null,inferred:false});
 return leaves;
}
```

按城市、岗位主类、维度建立reviewed岗位集合，长度为N；not_reviewed岗位整个维度不计分子或分母。叶子subject仅做NFKC、小写、空白归一化；以 `(城市,主类,维度,subject,kind)` 建jobKey集合，长度为n。必需、加分、未说明与三种alternative分类分列，各类可能重叠，不把它们相加当总岗位数。同条JD的冲突数、薪资编码/可读/未提供数量、匿名公司数量独立展示。第一版日期明确标为not_collected；不从observedAt计算岗位发布年龄。可读薪资不等于可计算金额，例如“面议”只展示原文，本期不做薪酬均值或年薪换算。

公司覆盖只按有依据的companyKey去重，null单列匿名/未知数量；不按字符串“某公司”合并。每个统计行保留jobKeys；明细保留requirementId、levelRaw、practice、year range、languageScenario、原文与条件树路径，不能只输出频次丢掉深度信息。

- [x] **Step 4：实现CSV。** 字段固定为studyId、jobKey、contentHash、cityGroup、roleFamily、requirementId、dimension、subject、necessity、logicPath、levelRaw、practice、minimumYears、maximumYears、languageScenario、evidenceTier、sourceField、quote。一行一个节点，组节点和子节点通过logicPath关联。

```js
const cell=value=>{
 const raw=String(value??'');
 const safe=/^[\s\uFEFF]*[=+@-]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
};
const csvLine=values=>values.map(cell).join(',');
```

- [x] **Step 5：回归。** 验证any不变全部必需、preferred父节点限制子项、推断祖先不混入事实、同技能不同JD计两条、城市和方向分母隔离、n≤N、未审阅不计零、匿名不合并、CSV逗号/引号/换行/前导空白公式安全。`node --test tests/china/market-summary.test.mjs`通过；对4条真实输出逐行核对jobKeys与n/N。

## Task 5：薄CLI、不可变报告与工作流接入

**Files:** Create `china-market.mjs`、`tests/china/market-cli.test.mjs`；Modify `package.json`、`config/local-paths.txt`、`docs/CHINA_MARKET.md`、`docs/CHINA_JOBS.md`、`modes/_custom.md`。

**Interfaces:** 使用Task 2–4已有函数；复用parseArgs、isMainModule、getCareerOpsRoot。新增入口不导入任何浏览器模块。

```bash
node china-market.mjs prepare --study four-city-pilot-v1 --selection /absolute/private/selection.json
node china-market.mjs validate --study four-city-pilot-v1 --file /absolute/private/analysis.json
node china-market.mjs report --study four-city-pilot-v1 --file /absolute/private/analysis.json
```

全部支持 `--root PATH`、`--help`；没有隐式scan、queue、LLM请求或个人配置读取。selection文件形状为 `{scope,selected}`，与Task 2参数一致。时间由prepare运行时生成。

- [x] **Step 1：写CLI失败测试。** 使用spawnSync调用新入口，临时Data Root和fixture；--help不创建data。非法studyId、未知参数、坏JSON、超过10MiB、digest不匹配必须在输出写入前失败。缺个人CV/profile不影响运行。

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../../china-market.mjs',import.meta.url));
test('help is read-only and malformed arguments cannot create output',t=>{
 const root=mkdtempSync(join(tmpdir(),'market-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const run=args=>spawnSync(process.execPath,[entry,...args,'--root',root],{encoding:'utf8',timeout:10000});
 assert.equal(run(['--help']).status,0);assert.equal(existsSync(join(root,'data')),false);
 assert.equal(run(['prepare','--study','../bad','--selection','missing.json']).status,1);
 assert.equal(existsSync(join(root,'data')),false);
});
```

- [x] **Step 2：运行失败测试。** `node --test tests/china/market-cli.test.mjs`。
- [x] **Step 3：实现分发。** main返回退出码，入口统一捕获异常输出简短JSON。实现以下分支，不增加其他副作用：

```js
if(command==='prepare'){
 const selection=readJsonLimited(values.selection);
 const study=await prepareStudy(root,{studyId:values.study,createdAt:new Date().toISOString(),...selection});
 console.log(JSON.stringify(study.manifest));return 0;
}
const study=readStudy(root,values.study),bundle=readJsonLimited(values.file);
const validation=validateBundle(study,bundle);
if(command==='validate'){
 console.log(JSON.stringify(validation));return validation.valid?(validation.complete?0:2):2;
}
if(!validation.valid){console.log(JSON.stringify(validation));return 2;}
const summary=summarize(study,bundle);
const result=await saveReport(root,study,bundle,summary);
console.log(JSON.stringify(result));return summary.complete?0:2;
```

`readJsonLimited(path): object`定义在CLI内：stat限制10MiB、只接受常规文件、JSON解析失败报简短错误；prepare selection仅允许scope/selected，防止覆盖studyId或createdAt。

`saveReport(root,study,bundle,summary): Promise<{studyId,analysisDigest,status,reportDir}>`定义在CLI内，仅负责写出。目标为 `reports/china-market/<studyId>/<analysisDigest>/`，先全部验证再用同级临时目录+rename发布。包含summary.json、requirements.csv、analysis.json、validation.json和自动生成的market-report.md数据表。以固定目标锁防并发；相同digest重复调用核对已有文件内容后复用，不能覆盖不一致的旧结果。

analysisDigest固定为fingerprint(bundle)，报告绑定sourceDigest和analysisDigest。Codex的人类解释追加到单独 `interpretation.md`，不覆盖工具生成的数据表；个人路线另存 `route-delta.md`。缺数据也显示表头、已审阅分母、未知量；不生成虚构市场洞见。Markdown单元格转义管道、换行及HTML，原文完整保留在JSON/CSV。

- [x] **Step 4：接入已有工作流。** package添加 `china:market`=`node china-market.mjs`；local-paths加入 `china-market.mjs`，现有china/规则覆盖三个模块；现有test:china通配符自动纳入测试。CHINA_JOBS链接CHINA_MARKET，_custom更新为使用prepare/validate/report三条命令。
- [x] **Step 5：集成测试。** 合成store→prepare→analysis→validate→report，核对输出JSON/CSV、字节不变的store和JD、重复调用复用、坏分析不写报告、partial报告退出2且清晰标注。两个并发report只发布一次。执行 `npm run test:china`、`npm run lint`、`git diff --check`。本期不改桥接，不重新打开真实浏览器做桥接测试。

## Task 6：四城试样与正式市场报告

**Files:** private查询/选取清单、study数据包、报告目录。**Interfaces:** 使用既有china-jobs与Task 5入口；具体采样步骤遵循research runbook Task 3–4。

- [x] **Step 1：建立四城搜索清单。** 范围含AI应用/Agent/RAG、平台基础设施、算法模型、工程型解决方案；使用真实搜索URL，核验杭州/南京/福州筛选结果。不猜city编码，不仅搜Agent。
- [x] **Step 2：小批采集。** 每次最多5条、1页、15秒间隔。现有12条待办按相同URL尝试resume；列表变化保留旧批次并记录，再安排新的观察批次。禁止循环重试。
- [x] **Step 3：达到每城约5条时冻结20条试样。** 去重、来源和排除理由完整；类别或城市不足则记录实际数量，不用其他组替代。
- [x] **Step 4：分析并校验。** 每条按_custom工作流完整拆解；覆盖所有冲突/推断项，并复核至少5条完整记录。valid=false不生成报告，partial不能称研究完成。
- [x] **Step 5：形成初步报告。** 逐个城市/岗位方向展示真实N、要求频次、英语场景、技能程度、替代条件、经验冲突、薪资/时间缺失。抽查所有关键结论到原JD。
- [ ] **Step 6：补采到总计约60条、每城约15条。** 新study冻结新版本，不覆盖20条报告；新增记录抽查20%，所有冲突/不确定项复核。样本配额不用于推断城市招聘总量或密度。2026-09-11复盘：58条候选扩展报告已交付并复核，城市配额与方向覆盖仍属部分完成，待定向补采，不再以总数接近60将此项整体勾选。

验收：四城样本报告与明细齐备；有明确分组、分母和原文证据；相同岗位不重复计数；读者能看出哪些结论证据不足。薪资仍编码时报告可先完成要求分析。

## Task 7：复用既有能力体系，校准发展路线（最后可选，本轮延后）

**Files:** private个人来源、既有 `config/profile.yml`/`cv.md`（有确认后才写）、报告目录route-delta.md。**Interfaces:** intake/个人配置规则、upskill已有模式和source-of-truth边界。

- [ ] **Step 1：读取既有思源V2路线及当前实际进展。** 原路线是计划基线，不将其中的能力自评和里程碑当作已经验证完成。缺少证据时标记需要确认。
- [ ] **Step 2：整理个人证据。** 沿用intake把可核对材料映射到原有个人层；市场输出不自动转成个人技能声明。没有CV不影响此前市场报告，但影响个人匹配判断。
- [ ] **Step 3：生成路线差异表。** 每项含市场n/N、目标方向、现有证据、保留/提前/延后/补证/观察决定、交付物、验收方法和依赖。
- [ ] **Step 4：复用upskill的能力排除和学习建议规则。** 已有个人评估报告及tracker满足输入时运行既有脚本；未满足时提供证据驱动的路线建议，明确没有运行其聚合统计。
- [ ] **Step 5：输出近期2周两个主要交付物、随后4周里程碑。** 当前时间预算由用户实际安排确定；英语按阅读/会议/客户等场景验收，技能按独立实现、调试、评测、架构解释和可展示作品验收。

验收：每项路线调整有市场来源和个人依据；旧路线不会被无说明覆盖；后续投递/面试/反馈继续使用原有career-ops模块。思源写回作为单独动作处理。

## 五、测试与风险清单

| 风险 | 必须验证的结果 |
|---|---|
| 只凭列表年限筛选 | 保留列表/正文冲突，按证据展示 |
| “至少一门”被拆成全都必须 | any叶子只进入备选分类 |
| 多次提及放大频率 | 同jobKey每统计格最多一次 |
| 未审阅英语被当作不需要 | coverage未完成从分子/分母排除，报告partial |
| 公司或城市由查询猜测 | 需要实际原文依据，否则unknown |
| 旧JD混入新列表文本 | listingBinding不足时拒绝列表引用 |
| 同ID多个版本当作多个岗位 | 一个study只选一版并校验hash |
| 分析引用的是另一版JD | sourceDigest/contentHash不符则拒绝 |
| AI猜薪资/发布时间 | 第一版未知保留，不能进入金额或新鲜度统计 |
| CSV/Markdown原文改变显示行为 | 输出转义，原文JSON仍保持原样 |
| 上游功能重复建设 | 只改_custom与新增小工具，评分/upskill/tracker保持原实现 |

## 六、计划完成与后续项目

本期里程碑：M1四条样表；M2离线工具通过回归；M3四城20条初步报告；M4四城约60条报告；M5有依据的能力路线调整。

后续独立项目：网页发布/更新日期提取；原生薪资字体证据与国内薪酬归一化；猎聘真实完整JD验收；思源结果写回；周期任务和看板。各自另写实现/测试计划，本期不预先搭建这些系统。

执行建议为在当前任务逐项推进，先M1再M2，不一次写完所有模块才看分析结果。若执行时需要隔离已有改动，先按using-git-worktrees检查实际工作区并保留本fork尚未提交的依赖；不能从未包含适配器的HEAD直接建立空缺依赖的执行环境。

## 本轮执行结果（2026-09-11）

Tasks 1–5完成，Task 6首期报告已交付、城市与方向覆盖部分完成，Task 7延后（2026-09-11复盘校正）。先发布23条候选试样，再完成58条候选扩展研究（约60条目标），含54条可辨识技术/相关技术与4条职责待确认；12条相邻岗位排除，合计70条唯一完整来源。实际地点：上海17、杭州12、南京14、福州10、多地点3、远程2；各城市未达配额部分如实呈现，不用其他组冒充补齐。

研究four-city-market-v1；sourceDigest f30db4d1f203293c200a；最终analysisDigest 7b50b94f7cd21a81340f。1519要求节点、14年限差异、5明确英语案例，全部结构/引用校验通过；原文与排除依据完整保存。最终入口 reports/china-market/README.md。研究语义由Codex分析复核，不代表人工确认。

市场模块最新75测试全过；完整China回归曾173过/1跳过，最终渲染修复后的完整复跑卡在既有profile-persistence合成浏览器keepalive关闭，已停止其专用测试进程；新的离线模块与CLI测试已独立复跑通过。730源码语法检查及git diff --check通过。无Git提交、推送、投递、消息、自动化或思源写回。
