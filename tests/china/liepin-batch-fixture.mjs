const at = seconds => new Date(Date.UTC(2026, 9, 18, 0, 0, seconds)).toISOString();
export function envelope({ city = '上海', keyword = 'AI Agent', count = 2, id = 'offline-batch', offset = 0 } = {}) {
  const timestamp = n => at(n + offset);
  const href = `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(keyword)}&city=opaque-city`;
  const selectedJobs = Array.from({ length: count }, (_, i) => ({ url: `https://www.liepin.com/job/${100 + i}.shtml`, title: `${keyword} 工程师 ${i}`, location: city }));
  const records = selectedJobs.map((job, i) => ({ ...job, company: '离线测试公司', description: '负责生产级 Agent 平台开发、部署、工具调用、状态管理、测试评估与可观测系统建设，要求解释架构决策和故障恢复流程。', complete: true, captureMethod: 'browser_extension', observedAt: timestamp(31 + i * 30), searchContext: { batchId: id, city, keyword, listingHref: href } }));
  return { schemaVersion: 2, kind: 'liepin_visible_batch', batch: { id, ownerTabId: 7, extensionVersion: '0.5.0', city, keyword, startedAt: timestamp(0), endedAt: timestamp(90), status: 'done', stopReason: null, recordCount: count, selectedJobs, listingEvidence: { href, inputValue: keyword, selectedCity: city, at: timestamp(16) }, actions: [{ kind: 'search', href, at: timestamp(0) }, ...selectedJobs.map((job, i) => ({ kind: 'job-click', href, jobUrl: job.url, at: timestamp(30 + i * 30) }))], maxJobs: 2, minIntervalMs: 15000, exportedAt: timestamp(91) }, records };
}
