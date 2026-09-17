// Offline orchestration. Scope decisions and semantic analysis are explicit inputs;
// this module never labels an unread JD as reviewed or opens a browser.
import {loadMarketDefaults,applySalaryDefaults,applyChannelDefault} from './market-defaults.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,symlinkSync,lstatSync,rmSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withPipelineLock} from '../pipeline-lock.mjs';
import {fingerprint,openStore} from './store.mjs';
import {checkEvidence,validateBundle} from './market-analysis.mjs';
import {readStudy} from './market-study.mjs';
import {summarize} from './market-summary.mjs';
import {connectMarket} from './market-connections.mjs';
import {sourceGapReviews,closedReviews,marketSelection,reconcileCandidates,listingVersion,analysisTasks} from './market-workflow.mjs';
import {loadListingScreen} from './listing-screen.mjs';
import {normalizeListingCard} from './platforms.mjs';
import {saveReport,saveFiles,renderConnections} from '../china-market.mjs';

const json=x=>JSON.stringify(x,null,2)+'\n';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const tally=rows=>rows.reduce((o,v)=>(o[v]=(o[v]||0)+1,o),{});
const cell=v=>String(v??'未知').replace(/[|\r\n]/g,' ').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const table=(headers,rows)=>[headers,headers.map(()=>'---'),...rows].map(r=>'| '+r.map(cell).join(' | ')+' |').join('\n');
function atomicWrite(file,value){
 mkdirSync(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';
 try{writeFileSync(temp,json(value),{mode:0o600,flag:'wx'});renameSync(temp,file);}finally{rmSync(temp,{force:true});}
}

export async function reconcileWorkflow(root,{candidateFile,stateFile,pool,reviews=[],refreshKeys=[],screen=loadListingScreen(root),state=openStore(root)}){
 if(!screen?.policyDigest)throw new Error('market workflow requires a collection policy');
 const path=resolve(root,stateFile);
 return withPipelineLock(path,async()=>{
  const prior=existsSync(path)?read(path):{reviews:[]};
  const candidates=read(resolve(root,candidateFile)).records.map(c=>{
   if(!c.key||!c.card||(c.card.key&&c.card.key!==c.key))throw new Error('invalid candidate identity');
   return {...c,card:normalizeListingCard({...c.card,key:c.key})};
  });
  const history=new Map();
  for(const r of [...(prior.reviews||[]),...sourceGapReviews(state),...closedReviews(state,screen.policyDigest),...reviews]){
   if(!r.key||!r.listingVersion||!r.policyDigest||!r.status||!Number.isFinite(Date.parse(r.checkedAt)))throw new Error('invalid version-bound review');
   history.set(JSON.stringify([r.key,r.listingVersion,r.policyDigest,r.checkedAt,r.status]),r);
  }
  for(const key of refreshKeys){
   const c=candidates.find(c=>c.key===key);if(!c)throw new Error('unknown explicit refresh key');
   const r={key,listingVersion:listingVersion({...c.card,key}),policyDigest:screen.policyDigest,status:'retry_requested',checkedAt:new Date().toISOString()};history.set(randomUUID(),r);
  }
  const known=new Set(pool.records.map(r=>JSON.stringify([r.jobKey,r.contentHash])));
  const scopeTasks=Object.entries(state.jobs).filter(([key,j])=>j.latest&&!known.has(JSON.stringify([key,j.latest.hash])))
   .map(([jobKey,j])=>({jobKey,contentHash:j.latest.hash,capturePath:j.latest.capturePath,state:'pending_scope_review'}));
  const completed=[],analysisErrors=[],analyses=new Map();
  for(const r of pool.records.filter(r=>r.eligibility?.value==='eligible')){
   const ref=r.analysis?.requirementsRef;
   if(!ref?.path||ref.configurationHash!==pool.configurationHash||ref.jobKey!==r.jobKey||ref.contentHash!==r.contentHash)continue;
   try{
    if(!analyses.has(ref.path)){
     const bundle=read(resolve(root,ref.path)),study=readStudy(root,bundle.studyId),validation=validateBundle(study,bundle);
     if(!validation.valid)throw new Error('invalid analysis evidence');
     analyses.set(ref.path,new Map(bundle.records.map(a=>[a.jobKey,a])));
    }
    const a=analyses.get(ref.path).get(r.jobKey);
    if(a?.contentHash===r.contentHash&&Object.values(a.coverage).every(v=>v==='reviewed'))completed.push({jobKey:r.jobKey,contentHash:r.contentHash,configurationHash:pool.configurationHash,status:'analyzed'});
   }catch(e){analysisErrors.push({jobKey:r.jobKey,reference:ref.path,reason:e.message});}
  }
  const result={...reconcileCandidates({candidates,reviews:[...history.values()],policyDigest:screen.policyDigest,screen,
   archivedKeys:Object.entries(state.jobs).filter(([,j])=>j.latest).map(([k])=>k)}),reviews:[...history.values()],scopeTasks,analysisTasks:analysisTasks({pool,completed}),analysisErrors};
  atomicWrite(path,result);return result;
 });
}

export function buildMarketRelease({pool,configurationHash,study,bundle,classifications=[],candidates=null,state,defaults={}}){
 const selected=marketSelection(pool,configurationHash),active=pool.records.filter(r=>r.eligibility?.value==='eligible');
 if(selected.records.length!==active.length)throw new Error('market eligibility is incomplete');
 const sources=new Map(study.sources.map(s=>[s.jobKey,s]));
 if(active.length!==sources.size||active.some(r=>sources.get(r.jobKey)?.contentHash!==r.contentHash))throw new Error('market source version/selection mismatch');
 for(const r of active){const s=sources.get(r.jobKey);
  if([...r.eligibility.evidence,...r.location.evidence].some(e=>!checkEvidence(s,e)))throw new Error(`invalid scope evidence: ${r.jobKey}`);
 }
 const validation=validateBundle(study,bundle);
 if(!validation.valid)throw new Error(`invalid analysis: ${JSON.stringify(validation.errors.slice(0,3))}`);
 if(!validation.complete)throw new Error('incomplete market analysis; current release unchanged');
 const seen=new Set();for(const r of classifications){if(!selected.has(r.jobKey,r.contentHash)||seen.has(r.jobKey))throw new Error('classification version mismatch or duplicate');seen.add(r.jobKey);}
 const candidateKeys=new Set();
 for(const c of candidates?.records||[]){
  if(!c.key||!c.card||(c.card.key&&c.card.key!==c.key)||candidateKeys.has(c.key))throw new Error('invalid or duplicate candidate identity');candidateKeys.add(c.key);
  if(!['ready','excluded','needs_review','held_not_found','blocked','held_source_gap','held_scope_ambiguity'].includes(c.state))throw new Error('invalid candidate state');
  if(!candidates.policyDigest||c.policyDigest!==candidates.policyDigest||c.listingVersion!==listingVersion({...c.card,key:c.key}))throw new Error('candidate policy or version mismatch');
 }
 const channels=new Map(classifications.map(r=>[r.jobKey,r.channel?.value||'unknown']));
 const projected={...study,sources:study.sources.map(s=>{const policy=defaults.providers?.[s.jobKey.split(':')[0]];if(!policy)return s;return {...s,facts:{...(s.facts||{schemaVersion:1,dates:null}),compensation:applySalaryDefaults(s.facts?.compensation||((s.fields.salaryText||s.fields.salaryRaw)?{raw:s.fields.salaryText||s.fields.salaryRaw,evidence:[{field:'salaryText',quote:s.fields.salaryText||s.fields.salaryRaw}]}:null),policy)}};})};
 projected.manifest={...study.manifest,sourceDigest:fingerprint({scope:study.manifest.scope,sources:projected.sources})};
 const projectedBundle={...bundle,sourceDigest:projected.manifest.sourceDigest};
 const summary=summarize(projected,projectedBundle),connections=connectMarket(projected,summary,state);
 connections.originalSourceDigest=study.manifest.sourceDigest;
 connections.interpretationDefaults=defaults;
 connections.compensationFacts=projected.sources.map(s=>({jobKey:s.jobKey,contentHash:s.contentHash,compensation:s.facts?.compensation||null}));
 const tasks=analysisTasks({pool,completed:bundle.records.map(r=>({...r,configurationHash,status:'analyzed'}))});
 const stats={sourceRecords:pool.records.length,eligible:active.length,requirementsReviewed:tasks.filter(t=>t.state==='analyzed').length,requirementsPending:tasks.filter(t=>t.state!=='analyzed').length,
  poolStates:tally(pool.records.map(r=>r.eligibility.value)),cityOptions:tally(active.flatMap(r=>r.location.targetCities)),
  cityAnalysisGroups:tally(bundle.records.map(r=>r.cityGroup)),roleFamilies:tally(bundle.records.map(r=>r.roleFamily)),channels:tally(active.map(r=>channels.get(r.jobKey)||'unknown')),
  highlights:tally(active.filter(r=>r.watchlist).map(r=>typeof r.watchlist==='string'?r.watchlist:r.watchlist.company||r.watchlist.name||r.watchlist.label||'highlighted')),
  candidateStates:tally((candidates?.records||[]).map(r=>r.state)),pendingScope:candidates?.scopeTasks?.length??0,
  salary:summary.missingness.compensation,salaryText:{readable:summary.missingness.salary.readable,encoded:summary.missingness.salary.encoded,notProvided:summary.missingness.salary.notProvided},postingDates:{...summary.missingness.postingDate,jobs:undefined},conflicts:summary.missingness.conflicts};
 return{active,validation,summary,connections,tasks,stats};
}

function renderRelease({pool,study,stats,connections,corePath}){
 const skills=connections.skills.rows.filter(r=>r.scope==='all'&&r.kind==='required').slice(0,20);
 return `# 市场采集与分析闭环\n\n已完成七维分析 **${stats.requirementsReviewed}/${stats.eligible} 条**；待分析 ${stats.requirementsPending} 条。来源审计 ${stats.sourceRecords} 条，其余记录保留在排除台账。数据截至 ${cell(pool.dataThrough)}，不是发布当天的实时岗位总量。\n\n`+
 `统计单位为招聘广告。同一广告可能含多城市/多个子方向，同正文不同ID另有重复标记，不代表独立名额。\n\n`+
 `## 当前流程\n\n列表初筛 → 版本绑定的批准清单 → 低频读取完整JD → 范围证据审阅 → 冻结版本 → 七维语义分析 → 校验 → 统一发布。浏览器失败只阻塞采集，本地分析独立继续。\n\n`+
 `- [统一岗位表](jobs.md) · [猎头单独视图](headhunters.md) · [活动池](active-pool.json) · [排除台账](exclusion-ledger.json)\n`+
 `- [分析任务](analysis-tasks.json) · [采集及核实状态](candidate-workflow.json) · [批准采集清单](collection-ready.json)\n`+
  `- [完整七维结果](analysis.json) · [技能、日期与共享功能连接](workflow-report.md) · [逐条连接数据](connections.json)\n`+
  `- [技能分组](skills.md) · [数据缺口](data-quality.md) · [暂缓与阻塞原因](review-queue.md)\n`+
 `- [原生研究报告](${corePath}/market-report.md) · [原生要求明细CSV](${corePath}/requirements.csv)\n\n`+
 `## 覆盖\n\n${table(['实际地点选项','广告数（可多选）'],Object.entries(stats.cityOptions))}\n\n目标城市选项用于范围筛选，可以多选；以下地点分析分组用于单城对比，multiple、remote、conflict 单列，不自动并入某个城市。\n\n${table(['地点分析分组','广告数'],Object.entries(stats.cityAnalysisGroups))}\n\n${table(['岗位粗类','广告数'],Object.entries(stats.roleFamilies))}\n\n${table(['招聘渠道','已分类广告数'],Object.entries(stats.channels))}\n\n`+
 `## 已陈述的技能要求\n\n下列为已审阅技能节点中“要求”类的关键词提及，排除任选分支、优先项和推断。一条原文中的框架示例不等于要求精通每个框架；具体程度及条件见逐条证据。\n\n${table(['关键词','涉及广告数','已审阅分母'],skills.map(r=>[r.skill,r.count,r.denominator]))}\n\n`+
 `## 薪资、日期与冲突\n\n${table(['薪资币种','统一比较口径','可比广告数','广告区间中点中位数（年）'],(connections.compensationGroups||[]).map(g=>[g.currency,g.basis,g.jobs,g.medianRangeMidpoint]))}\n\n`+
 `薪资事实：${cell(JSON.stringify(stats.salary))}。发布日期事实：${cell(JSON.stringify(stats.postingDates))}。正文/列表等已记录冲突 ${stats.conflicts.count} 项，涉及 ${stats.conflicts.jobs} 条广告。缺失日期保持未知，首次采集不作上新日；归档不证明当前开放。\n\n`+
 `## 后续任务\n\n${table(['状态','条数'],Object.entries(stats.candidateStates))}\n\n`+
  `ready 仅允许读取JD；needs_review 尚未核实；held_scope_ambiguity 已核实但卡片不能证明AI技术职责或实际地点；held_not_found 已查看原列表但没再出现；blocked 等待会话或读取问题恢复；excluded 不采。暂缓记录不自动重复核实，新事实版本或明确刷新才重试。待正文范围复核 ${stats.pendingScope} 条；来源证据不足 ${stats.poolStates.unresolved_source||0} 条继续退出活动池。\n\n`+
 `本次已完成本地有效池要求分析；四城市场覆盖和半年历史仍未证明完整。个人评分、简历、申请与能力路线尚未启动。\n`;
}

export async function publishMarketRelease(root,options){
 root=realpathSync(root);
 const defaults=loadMarketDefaults(root);
 options={...options,defaults,classifications:(options.classifications||[]).map(r=>({...r,channel:applyChannelDefault(r.channel,defaults.providers?.[r.jobKey.split(':')[0]])}))};
 const {pool,study,bundle,releaseId,configurationHash,classifications=[],candidates=null,state=openStore(root)}=options;
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(releaseId))throw new Error('invalid release ID');
 // Re-read the actual frozen study, not just a caller's manufactured manifest.
 if(fingerprint(readStudy(root,study.manifest.studyId))!==fingerprint(study))throw new Error('frozen study differs');
 const built=buildMarketRelease({...options,state});
 const implementationDigest=fingerprint([import.meta.url,new URL('./market-workflow.mjs',import.meta.url)].map(p=>readFileSync(new URL(p),'utf8')));
 const digest=fingerprint({defaults,pool,configurationHash,study,bundle,classifications,candidates,connections:built.connections,implementationDigest});
 const parts=['reports','china-market','releases',`${releaseId}-${digest}`],rel=parts.join('/');
 const records=pool.records.map(r=>r.eligibility.value==='eligible'?{...r,sourceRef:{...r.sourceRef,path:`data/china/research/${study.manifest.studyId}/source-jobs.json`},analysis:{...r.analysis,sevenDimensions:'reviewed',requirementsRef:{path:rel+'/analysis.json',jobKey:r.jobKey,contentHash:r.contentHash,configurationHash}}}:r);
 const publishedPool={...pool,records},active=records.filter(r=>r.eligibility.value==='eligible');
 const publishedTasks=built.tasks.map(t=>({...t,sourceRef:active.find(r=>r.jobKey===t.jobKey).sourceRef}));
 const classificationsOut=classifications.map(r=>({...r,sourceRef:active.find(a=>a.jobKey===r.jobKey).sourceRef,inherited:r.inherited?{...r.inherited,analysis:active.find(a=>a.jobKey===r.jobKey).analysis}:r.inherited}));
 const core=await saveReport(root,study,bundle,summarize(study,bundle));
 const byChannel=new Map(classifications.map(r=>[r.jobKey,r.channel?.value]));
 const channelStatus=new Map(classifications.map(r=>[r.jobKey,r.channel?.status]));
 const sources=new Map(study.sources.map(s=>[s.jobKey,s]));
 const analysisByKey=new Map(bundle.records.map(r=>[r.jobKey,r]));
 const salaryByKey=new Map(built.summary.missingness.salary.jobs.map(r=>[r.jobKey,r]));
 const jobs=rows=>table(['关注','岗位ID','公司展示名','岗位','目标城市选项','地点分析状态','招聘渠道','薪资显示','平台经验','来源公司规模','要求状态'],rows.map(r=>{const s=sources.get(r.jobKey),salary=salaryByKey.get(r.jobKey);return[r.watchlist?.label||'',r.jobKey,r.company,r.url?.startsWith('https://')?`[${cell(r.title).replace(/[\[\]]/g,'')}](${r.url})`:r.title,r.location.targetCities.join('/'),analysisByKey.get(r.jobKey).cityGroup,(byChannel.get(r.jobKey)==='hr'?(channelStatus.get(r.jobKey)==='assumed'?'HR（默认）':'HR'):byChannel.get(r.jobKey)||'unknown'),salary.salaryText||(salary.encoded?'待解码（缺同版本字体证据）':'未提供'),s.fields.experience||'未提供',s.fields.companySizeRaw||'未提供','七维已审阅'];}));
 const skillKinds=['required','preferred','unspecified','alternative_required','alternative_preferred','alternative_unspecified'];
 const skillReport='# 已审阅技能关键词\n\n按原生 skill-extract 词表对证据节点归并，分组可重叠，不能相加；框架例举仍看原文条件，未映射能力保留于完整要求。\n\n'+skillKinds.map(kind=>`## ${kind}\n\n`+table(['关键词','广告数','分母'],built.connections.skills.rows.filter(r=>r.scope==='all'&&r.kind===kind).map(r=>[r.skill,r.count,r.denominator]))).join('\n\n')+'\n';
 const quality='# 数据缺口与统计口径\n\n七维完整表示读过要求，不表示来源提供了每个字段。\n\n'+
  table(['项目','数值'],[['薪资文本可读',built.stats.salaryText.readable],['历史编码缺少解码证据',built.stats.salaryText.encoded],['薪资未提供',built.stats.salaryText.notProvided],['可按同币种周期比较',built.stats.salary.known],['已解析日薪（不强行年化）',built.stats.salary.nonAnnual||0],['薪资单位或结构未解析',built.stats.salary.unresolved],['发布日期明确',built.stats.postingDates.known]])+
  '\n\n薪资按 interpretation-defaults.json 的用户规则解释；默认值保留 userDefault 标记，明确单位优先。月薪×12仅为共同基准，未计额外薪月或保证奖金。3类日期（发布/更新/有效期）均可在 connections.json 查看，缺失保持未知。\n\n'+
  table(['岗位','编码状态'],built.summary.missingness.salary.jobs.filter(r=>r.status==='encoded').map(r=>[r.jobKey,'历史快照缺同次字体/解码证据；不猜数字']))+'\n';
 const reviewReport='# 已核实的暂缓与阻塞线索\n\n这些卡片不进入有效市场分母，也不会自动反复读取。所需证据必须来自同一岗位；不以公司名或搜索词补造职责。\n\n'+table(['岗位ID','岗位','状态','原因','需要的证据'],(candidates?.records||[]).filter(r=>r.state!=='ready'&&r.state!=='excluded').map(r=>[r.key,r.card.title,r.state,r.review?.reason||r.rule,r.review?.requiredEvidence||(r.state==='held_not_found'?'同一岗位重新出现或明确源信息':r.state==='blocked'?'会话/读取恢复后明确重试':'同一岗位的地点与AI技术职责')]))+'\n';
 const files={'pool.json':json(publishedPool),'active-pool.json':json({...publishedPool,records:active}),'exclusion-ledger.json':json({records:records.filter(r=>r.eligibility.value!=='eligible')}),
  'interpretation-defaults.json':json(defaults),'analysis.json':json(bundle),'analysis-tasks.json':json({configurationHash,records:publishedTasks}),'validation.json':json(built.validation),'summary.json':json(built.stats),'classifications.json':json({records:classificationsOut}),
  'connections.json':json(built.connections),'workflow-report.md':renderConnections(built.connections),
  'skills.md':skillReport,'data-quality.md':quality,'review-queue.md':reviewReport,
  'candidate-workflow.json':json({...candidates,records:candidates?.records||[],summary:built.stats.candidateStates,analysisTasks:publishedTasks,analysisErrors:[]}),'collection-ready.json':json({schemaVersion:1,policyDigest:candidates?.policyDigest??null,records:(candidates?.records||[]).filter(r=>r.state==='ready')}),
  'jobs.md':'# 当前有效岗位\n\n招聘广告粒度，多城市/多方向不拆成独立名额；展示公司不等于核实雇主。\n\n'+jobs(active)+'\n',
  'headhunters.md':'# 猎头发布的有效岗位\n\n中介、展示公司、实际用人方及签约关系保持区分。\n\n'+jobs(active.filter(r=>byChannel.get(r.jobKey)==='headhunter'))+'\n',
  'README.md':renderRelease({...built,pool,study,corePath:core.reportDir}),
  'release.json':json({releaseId,digest,implementationDigest,configurationHash,studyId:study.manifest.studyId,sourceDigest:study.manifest.sourceDigest,analysisDigest:core.analysisDigest,coreReport:relative(root,core.reportDir),report:rel+'/README.md',stats:built.stats})};
 const saved=await saveFiles(root,parts,files),parent=join(root,'reports/china-market');
 await withPipelineLock(join(parent,'.publish-current'),async()=>{
  const current=join(parent,'current');if(existsSync(current)&&!lstatSync(current).isSymbolicLink())throw new Error('current report pointer is not a symlink');
  const temp=join(parent,'.current-'+randomUUID());
  try{symlinkSync(relative(parent,saved.reportDir),temp);renameSync(temp,current);}finally{rmSync(temp,{force:true});}
 });
 return{...saved,report:rel+'/README.md',digest,stats:built.stats};
}
