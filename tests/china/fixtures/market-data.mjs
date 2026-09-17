import { recordObservation, openStore, saveStore } from '../../../china/store.mjs';

export const description = '要求具备三年以上后端开发经验，能独立完成服务设计。Python或Java至少精通一门；Docker经验优先。英语用于阅读技术文档。';

export function seed(root) {
  const state = openStore(root);
  const job = recordObservation(root, state, {
    platform: 'boss',
    url: 'https://www.zhipin.com/job_detail/marketfixture.html',
    title: 'AI应用工程师',
    company: '合成公司',
    location: '上海',
    description,
    status: 'ok',
    listingText: 'AI应用工程师\n合成公司\n上海\n经验不限',
    observedAt: '2026-09-10T00:00:00.000Z',
  });
  saveStore(root, state);
  return { state, job, selected: [{ jobKey: job.key, contentHash: job.latest.hash }] };
}

export function options(selected) {
  return {
    studyId: 'market-fixture',
    scope: { cities: ['上海'], keywords: ['AI'], queryUrls: [] },
    selected,
    createdAt: '2026-09-10T01:00:00.000Z',
  };
}

export function analysis(study) {
  const source = study.sources[0], quote = '英语用于阅读技术文档', start = source.fields.description.indexOf(quote);
  return { schemaVersion: 1, studyId: study.manifest.studyId, sourceDigest: study.manifest.sourceDigest, records: [{
    jobKey: source.jobKey, contentHash: source.contentHash, analysisVersion: 'market-v1', analyzedAt: '2026-09-10T02:00:00.000Z',
    roleFamily: 'unknown', roleFamilyEvidence: null, cityGroup: 'unknown', cityEvidence: [], companyKey: null, companyEvidence: null,
    coverage: Object.fromEntries(['experience', 'language', 'skill', 'education', 'delivery', 'domain', 'work_conditions'].map(d => [d, 'reviewed'])),
    requirements: [{ id: 'r1', dimension: 'language', subject: '英语阅读', necessity: 'required', evidenceTier: 'stated',
      evidence: { field: 'description', start, end: start + quote.length, quote }, levelRaw: null, practice: [], minimumYears: null, maximumYears: null,
      languageScenario: ['reading'], logic: 'single', alternatives: [] }], conflicts: [],
  }] };
}
