import test from 'node:test';
import assert from 'node:assert/strict';
import {familyOf, FAMILY_TAXONOMY, loadRoleFamilyPolicy, classifyWithPolicy} from '../../china/market-role-family.mjs';

// Forward-deployed seats are delivery seats. Before this rule existed an FDE
// title matched nothing and fell through to other_technical, the bucket for
// evaluation, data and operations work, which mislabelled 61 of 89 postings in
// the four-city pool and skewed the role-family breakdown the user reads.
test('forward-deployed titles classify as delivery, not other_technical', () => {
  for (const title of [
    'FDE工程师/AI工程师',
    '前沿部署工程师 (FDE)- 半导体 AI',
    'FDE 交付负责人（大模型交付/前沿部署）',
    'AI 前沿部署工程师（Forward Deployed Engineer）・Copilot 方向',
    '人工智能应用工程师FDE',
    'Junior Forward Deployed Engineer (FDE) — Enterprise AI',
    'AI前沿部署工程师-FDE-上海',
  ]) assert.equal(familyOf(title), 'engineering_solution', title);
});

test('a delivery title that also names a model technology keeps its delivery family', () => {
  // "医疗FDE（算法）" is a forward-deployed seat at a hospital, not a research seat.
  assert.equal(familyOf('医疗FDE（算法）'), 'engineering_solution');
  assert.equal(familyOf('FDE 技术负责人（AI Native 全栈）'), 'engineering_solution');
  assert.equal(familyOf('中高级 FDE 算法先锋工程师'), 'engineering_solution');
});

test('model-research and evaluation titles keep their existing families', () => {
  assert.equal(familyOf('大模型算法工程师'), 'algorithm_model');
  assert.equal(familyOf('多模态大模型具身算法工程师'), 'algorithm_model');
  assert.equal(familyOf('Agent评测工程师'), 'other_technical');
  assert.equal(familyOf('AI 质量与评测工程师 (MJ002813)'), 'other_technical');
});

test('infrastructure and agent titles are unaffected', () => {
  assert.equal(familyOf('大模型推理引擎工程师'), 'platform_infra');
  assert.equal(familyOf('Agent 全栈开发智能客服'), 'application_agent');
});

test('Latin keywords in a title are matched regardless of case', () => {
  assert.equal(familyOf('agent 开发工程师'), 'application_agent');
  assert.equal(familyOf('大模型 rag 工程师'), 'application_agent');
  assert.equal(familyOf('ai infra 工程师'), 'platform_infra');
  assert.equal(familyOf('agent 评测工程师'), 'other_technical');
});

test('a title with no specific family signal waits for JD review', () => {
  for (const title of ['', 'AI Builder', '高可用架构师', 'Storage Engineer']) {
    assert.equal(familyOf(title), 'unknown', title);
  }
  assert.equal(familyOf('数据标注工程师'), 'other_technical');
});

test('the taxonomy exposes the six published families', () => {
  assert.deepEqual([...FAMILY_TAXONOMY].sort(), ['algorithm_model', 'application_agent', 'engineering_solution', 'other_technical', 'platform_infra', 'unknown'].sort());
});

test('a user policy can pin a title pattern to a family without editing code', () => {
  const policy = {overrides: [{match: 'FDE', family: 'application_agent', reason: '用户口径：本池 FDE 一律按应用工程统计'}]};
  assert.equal(classifyWithPolicy('FDE工程师/AI工程师', policy), 'application_agent');
  // A pattern outside the policy keeps the shipped default.
  assert.equal(classifyWithPolicy('大模型算法工程师', policy), 'algorithm_model');
});

test('a policy override that does not match leaves the default answer intact', () => {
  const policy = {overrides: [{match: '不存在的岗位关键词', family: 'platform_infra'}]};
  assert.equal(classifyWithPolicy('大模型算法工程师', policy), 'algorithm_model');
});

test('loadRoleFamilyPolicy reads the user defaults file and tolerates its absence', () => {
  assert.deepEqual(loadRoleFamilyPolicy('/nonexistent-root-for-test'), {overrides: []});
});
