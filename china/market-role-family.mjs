// Role-family classification for the China market study.
//
// This used to live inside each round's generator under
// data/china/research/planning/<round>/gen.mjs. Everything under data/ is
// gitignored, so the title suggestion used when reviewing roleFamily was never
// reviewed, never tested, and silently diverged between rounds. FDE / 前沿部署
// was simply absent from the keyword list, so forward-deployed postings fell
// through every rule into other_technical — the bucket meant for evaluation,
// data and operations work — and 61 of 89 FDE postings in the four-city pool
// were mislabelled. Keeping the rule here makes it reviewable and testable.
//
// Order matters: the first match wins, so a delivery seat stays delivery even
// when its title also names a model technology.
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

// The six families the published bundle accepts (see FAMILIES in market-analysis.mjs).
export const FAMILY_TAXONOMY = ['application_agent', 'platform_infra', 'algorithm_model', 'engineering_solution', 'other_technical', 'unknown'];

const RULES = [
  // Forward-deployed work is delivery work: the job is to sit with a customer,
  // find the use case, build the demo and carry it to adoption. FDE, 前沿部署,
  // 前向部署 and 前置部署 are the names this ships under in Chinese postings.
  [/解决方案|交付|实施|售前|咨询|技术支持|\bPMO\b|项目经理|\bFDE\b|前沿部署|前向部署|前置部署|\bForward[ -]?Deployed\b/i, 'engineering_solution'],
  [/推理框架|推理引擎|推理优化|推理加速|训练框架|\bInfra\b|基础设施|平台|模型服务|算力|调度|存储|性能|\bRuntime\b|分布式|异构|算子|编译|\bMLOps\b|云原生|后端开发|服务端/i, 'platform_infra'],
  [/算法|研究员|研究|模型训练|预训练|后训练|微调|多模态|语音|\b(?:NLP|CV)\b|视觉|强化学习|推荐|机器学习|数据挖掘|数据科学/i, 'algorithm_model'],
  [/\bAgent\b|智能体|\bRAG\b|应用|客服|\bCopilot\b|助手|全栈|前端|\bAI\b工程师|大模型开发|业务技术/i, 'application_agent'],
  [/评测|评估|\bBenchmark\b|数据|标注|运营|测试|分析师/i, 'other_technical'],
];

// Evaluation / benchmarking is its own main class unless the title also claims a
// model-research or algorithm seat; the brief's 8-way taxonomy maps onto the
// bundle's 6-way roleFamily, so 评测 lands in other_technical by default.
// This is a title-only suggestion; the final family follows the JD's main
// responsibilities and must carry a source quote. No title signal means unknown.
export function familyOf(title) {
  const t = title || '';
  if (/评测|评估|Benchmark/i.test(t)) return /算法|研究员|研究岗|科学家/.test(t) ? 'algorithm_model' : 'other_technical';
  if (/目标检测|图像分割|图像识别|OCR|人脸|点云|SLAM|三维重建|姿态估计/.test(t)) return 'algorithm_model';
  for (const [re, f] of RULES) if (re.test(t)) return f;
  return 'unknown';
}

// Optional user overrides, read from the same market-defaults.json that already
// carries the salary and channel defaults, so a preference such as "count FDE
// under application engineering" is a config change rather than a code edit.
// Shape: {"roleFamily": {"overrides": [{"match": "FDE", "family": "application_agent"}]}}
export function loadRoleFamilyPolicy(root) {
  const path = join(root, 'data/china/market-defaults.json');
  if (!existsSync(path)) return {overrides: []};
  try {
    const overrides = JSON.parse(readFileSync(path, 'utf8'))?.roleFamily?.overrides;
    return {overrides: Array.isArray(overrides) ? overrides.filter(o => o && typeof o.match === 'string' && FAMILY_TAXONOMY.includes(o.family)) : []};
  } catch {
    return {overrides: []};
  }
}

export function classifyWithPolicy(title, policy = {}) {
  const t = title || '';
  for (const o of policy?.overrides || []) {
    if (!o || typeof o.match !== 'string' || !FAMILY_TAXONOMY.includes(o.family)) continue;
    if (t.toLowerCase().includes(o.match.toLowerCase())) return o.family;
  }
  return familyOf(t);
}
