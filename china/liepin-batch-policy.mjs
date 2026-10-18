// Shared by the ordinary Chrome extension and the offline receipt validator.
// Keep the factory self-contained: the builder serializes it into the extension.
export function createLiepinBatchPolicy() {
  const cities = ['上海', '杭州', '南京', '福州'];
  const keywords = ['AI Agent', 'FDE'];
  const intervalMs = 15000;
  const hosts = ['www.liepin.com', 'liepin.com', 'c.liepin.com'];
  const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const finiteDate = value => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const isHost = url => hosts.includes(url.hostname) && !url.username && !url.password && (url.port === '' || url.port === '443');
  const isListingPath = pathname => /^\/zhaopin\/?$/.test(pathname);
  const isJobPath = pathname => /^\/(job|a)\/\d+\.shtml$/.test(pathname);

  function config(value) {
    if (!value || !cities.includes(value.city) || !keywords.includes(value.keyword)) {
      throw new Error('城市或关键词不在本轮计划中');
    }
    return { city: value.city, keyword: value.keyword };
  }

  function listingEvidence(value, target) {
    config(target);
    if (!value || typeof value !== 'object') throw new Error('缺少可见列表证据');
    let url;
    try { url = new URL(value.href); } catch { throw new Error('列表地址无效'); }
    if (url.protocol !== 'https:' || !isHost(url) || !isListingPath(url.pathname)) throw new Error('不是猎聘列表页');
    // URLSearchParams decodes the key once. Do not call decodeURIComponent or
    // replace('+', ' ') on the returned value: %2B must remain a literal '+'.
    const key = url.searchParams.get('key');
    if (key !== target.keyword || value.inputValue !== target.keyword) {
      throw new Error('关键词与当前批次不匹配');
    }
    // The city value is an opaque platform value (often an id). The visible
    // selected-city text is the admissible identity evidence; it is still
    // mandatory that the URL carries a non-empty city filter.
    if (!String(url.searchParams.get('city') || '').trim() || value.selectedCity !== target.city) {
      throw new Error('城市筛选未在当前页面确认');
    }
    const at = finiteDate(value.at);
    if (!Number.isFinite(at)) throw new Error('列表证据缺少时间');
    return { ...value, keyword: target.keyword, city: target.city };
  }

  function jobUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('岗位地址无效'); }
    if (url.protocol !== 'https:' || !isHost(url) || !isJobPath(url.pathname)) throw new Error('岗位地址无效');
    return `https://www.liepin.com${url.pathname}`;
  }

  function validateRecord(record, batch) {
    config(batch);
    if (!record || typeof record !== 'object') throw new Error('回执包含无效岗位记录');
    const expected = batch.selectedJobs?.[batch.records?.length || 0] || batch.jobs?.[batch.records?.length || 0];
    if (!expected || jobUrl(record.url) !== jobUrl(expected.url)) throw new Error('详情不是待采岗位');
    if (typeof record.title !== 'string' || !record.title.trim() || normalize(record.title) !== normalize(expected.title)) {
      throw new Error('详情标题与列表身份不匹配');
    }
    if (typeof record.location !== 'string' || !record.location.trim() || !normalize(record.location).includes(batch.city)) {
      throw new Error('岗位实际地点不属于目标城市，停止而非跳过');
    }
    if (record.captureMethod !== 'browser_extension' || record.complete !== true || typeof record.description !== 'string' || record.description.trim().length < 40) {
      throw new Error('不是完整的可见 JD');
    }
    const at = finiteDate(record.observedAt);
    const start = finiteDate(batch.startedAt);
    if (!Number.isFinite(at) || !Number.isFinite(start) || at < start) throw new Error('采集时间无效');
    const previous = batch.records?.at(-1);
    if (previous && at - finiteDate(previous.observedAt) < intervalMs) throw new Error('两次采集不足15秒');
    if ((batch.records?.length || 0) >= 2 || (batch.records || []).some(r => jobUrl(r.url) === jobUrl(record.url))) {
      throw new Error('批次超过2条或岗位重复');
    }
    return true;
  }

  function receipt(batch, exportedAt) {
    const records = Array.isArray(batch?.records) ? batch.records : [];
    return {
      schemaVersion: 2,
      kind: 'liepin_visible_batch',
      batch: {
        id: batch.id,
        ownerTabId: batch.ownerTabId,
        extensionVersion: batch.extensionVersion ?? batch.version,
        version: batch.version ?? batch.extensionVersion,
        city: batch.city,
        keyword: batch.keyword,
        startedAt: batch.startedAt,
        endedAt: batch.endedAt,
        status: batch.status,
        stopReason: batch.stopReason || null,
        recordCount: records.length,
        selectedJobs: batch.selectedJobs || batch.jobs || [],
        listingEvidence: batch.listingEvidence || batch.evidence || null,
        actions: batch.actions || [],
        maxJobs: 2,
        minIntervalMs: intervalMs,
        exportedAt,
        ...(batch.searchContext ? { searchContext: batch.searchContext } : {}),
      },
      records,
    };
  }

  function validateReceipt(value) {
    if (!value || value.schemaVersion !== 2 || value.kind !== 'liepin_visible_batch') {
      throw new Error('缺少有边界的猎聘批次回执');
    }
    const batch = value.batch;
    config(batch);
    const extensionVersion = batch.extensionVersion ?? batch.version;
    if (batch.extensionVersion !== undefined && batch.version !== undefined && batch.extensionVersion !== batch.version) throw new Error('批次扩展版本字段不一致');
    if (!batch.id || !Number.isInteger(batch.ownerTabId) || typeof extensionVersion !== 'string' || !extensionVersion.trim() || batch.status !== 'done' || (batch.stopReason !== null && batch.stopReason !== undefined && String(batch.stopReason).trim())) {
      throw new Error('只接受成功完成的单标签批次');
    }
    if (batch.maxJobs !== 2 || batch.minIntervalMs !== intervalMs) throw new Error('批次预算不匹配');
    const start = finiteDate(batch.startedAt), end = finiteDate(batch.endedAt), exported = finiteDate(batch.exportedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(exported) || end < start || exported < end) throw new Error('批次起止时间无效');
    const evidence = listingEvidence(batch.listingEvidence, batch);
    const listingAt = finiteDate(evidence.at);
    if (listingAt < start || listingAt > end) throw new Error('列表证据不在本批时间内');
    if (!Array.isArray(value.records) || value.records.length < 1 || value.records.length > 2 || batch.recordCount !== value.records.length) {
      throw new Error('回执不是1–2条有边界记录');
    }
    if (!Array.isArray(batch.selectedJobs) || batch.selectedJobs.length !== value.records.length) throw new Error('批次岗位计划不完整');
    const selectedUrls = new Set();
    for (const selected of batch.selectedJobs) {
      if (!selected || typeof selected.title !== 'string' || !selected.title.trim()) throw new Error('批次岗位身份不完整');
      const url = jobUrl(selected.url);
      if (selectedUrls.has(url)) throw new Error('批次岗位重复');
      selectedUrls.add(url);
      if (selected.location !== undefined && (typeof selected.location !== 'string' || !normalize(selected.location).includes(batch.city))) throw new Error('批次岗位城市身份不匹配');
    }
    if (!Array.isArray(batch.actions) || !batch.actions.length) throw new Error('缺少操作时间记录');
    const actions = [];
    for (const action of batch.actions) {
      if (!action || typeof action !== 'object' || typeof action.kind !== 'string' || !action.kind.trim()) throw new Error('操作记录类型无效');
      const at = finiteDate(action.at);
      if (!Number.isFinite(at) || at < start || at > end) throw new Error('浏览器操作时间无效');
      let href;
      try { href = new URL(action.href); } catch { throw new Error('浏览器操作地址无效'); }
      if (href.protocol !== 'https:' || !isHost(href)) throw new Error('动作离开猎聘');
      if (action.kind === 'search' && !isListingPath(href.pathname)) throw new Error('搜索动作不是列表页');
      if (action.kind === 'job-click') {
        if (!action.jobUrl) throw new Error('岗位点击缺少岗位地址');
        const clicked = jobUrl(action.jobUrl);
        if (!selectedUrls.has(clicked)) throw new Error('岗位点击不在本批次岗位计划中');
      }
      actions.push({ ...action, at });
    }
    for (let i = 1; i < actions.length; i++) {
      if (actions[i].at - actions[i - 1].at < intervalMs) throw new Error('浏览器动作间隔不足15秒');
    }
    if (!actions.some(a => a.kind === 'search')) throw new Error('缺少可见搜索提交记录');
    const replay = { city: batch.city, keyword: batch.keyword, startedAt: batch.startedAt, selectedJobs: batch.selectedJobs, records: [] };
    for (const record of value.records) {
      if (!record.searchContext || record.searchContext.batchId !== batch.id || record.searchContext.city !== batch.city || record.searchContext.keyword !== batch.keyword || record.searchContext.listingHref !== evidence.href) {
        throw new Error('记录不属于此批次上下文');
      }
      if (typeof record.url !== 'string' || typeof record.title !== 'string' || typeof record.location !== 'string') throw new Error('记录缺少岗位身份字段');
      validateRecord(record, replay);
      const observed = finiteDate(record.observedAt);
      if (!Number.isFinite(observed) || observed > end) throw new Error('记录时间晚于批次结束');
      if (!actions.some(a => a.kind === 'job-click' && jobUrl(a.jobUrl) === jobUrl(record.url) && a.at <= observed)) {
        throw new Error('缺少对应岗位的可见点击记录');
      }
      replay.records.push(record);
    }
    return value;
  }

  return { cities, keywords, intervalMs, normalize, config, listingEvidence, jobUrl, validateRecord, receipt, validateReceipt };
}
export const liepinBatchPolicy = createLiepinBatchPolicy();
