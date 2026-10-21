// Self-reported browser evidence; internal consistency is not independent attestation.
export function createBossBatchPolicy() {
  const cities = ['上海', '杭州', '南京', '福州'];
  const keywords = ['AI Agent', 'FDE'];
  const intervalMs = 15000;
  const hosts = ['www.zhipin.com', 'zhipin.com'];
  function validUrl(value, path = /^\/web\/geek\/jobs\/?$/) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port && path.test(u.pathname) ? u : null;
    } catch { return null; }
  }
  function config(v) {
    if (!v || !cities.includes(v.city) || !keywords.includes(v.keyword)) throw new Error('BOSS城市或关键词不在计划中');
    return {city: v.city, keyword: v.keyword};
  }
  function listingEvidence(e, target) {
    config(target);
    const u = validUrl(e?.href);
    if (!u || u.searchParams.getAll('query').length !== 1 || u.searchParams.get('query') !== target.keyword || e.inputValue !== target.keyword) throw new Error('BOSS关键词与列表证据不匹配');
    if (u.searchParams.getAll('city').length !== 1 || !u.searchParams.get('city') || e.selectedCity !== target.city || e.cityParam !== u.searchParams.get('city')) throw new Error('BOSS城市证据不匹配');
    if (!Number.isFinite(Date.parse(e.at))) throw new Error('BOSS列表证据时间无效');
    return {...e, city: target.city, keyword: target.keyword};
  }
  function jobUrl(v) {
    const u = validUrl(v, /^\/job_detail\/[A-Za-z0-9_-]+\.html$/);
    if (!u) throw new Error('BOSS岗位URL无效');
    return 'https://www.zhipin.com' + u.pathname;
  }
  const belongs = (location, city) => String(location || '').trim().startsWith(city);
  function validateRecord(r, b) {
    config(b);
    const expected = (b.selectedJobs || b.jobs || [])[(b.records || []).length];
    const detail = {got: {url: r?.url, title: r?.title, location: r?.location}, want: {url: expected?.url, title: expected?.title, location: expected?.location}};
    if (!r || !expected || jobUrl(r.url) !== jobUrl(expected.url) || !r.title?.trim() || r.title !== expected.title || !belongs(r.location, b.city) || !belongs(expected.location, b.city)) throw new Error('BOSS详情身份或地点不匹配 ' + JSON.stringify(detail).slice(0, 400));
    if (r.captureMethod !== 'browser_extension' || r.complete !== true || typeof r.description !== 'string' || r.description.trim().length < 40) throw new Error('BOSS不是完整可见JD');
    const at = Date.parse(r.observedAt), start = Date.parse(b.startedAt);
    if (!Number.isFinite(at) || at < start || (b.endedAt && at > Date.parse(b.endedAt))) throw new Error('BOSS观测时间无效');
    const prev = (b.records || []).at(-1);
    if (prev && at - Date.parse(prev.observedAt) < intervalMs) throw new Error('BOSS详情观测间隔不足15秒');
    const p = r.searchContext?.panelEvidence;
    if (!p || jobUrl(p.jobUrl) !== jobUrl(r.url) || p.title !== r.title || p.at !== r.observedAt) throw new Error('BOSS面板身份或时间证据不匹配');
    // BOSS sometimes omits the region in the detail panel. Then the location may
    // come from the same job's visible listing card, but only if that is recorded
    // explicitly; it is never inferred or back-filled silently.
    if (p.location === r.location) {
      if (r.locationSource !== undefined && r.locationSource !== 'detail_panel') throw new Error('BOSS地点来源标注不匹配 ' + JSON.stringify(detail).slice(0, 400));
    } else if (p.location === '' && r.locationSource === 'listing_card' && r.location === expected.location) {
      // allowed: panel had no region, listing card supplied the same job's region
    } else throw new Error('BOSS地点证据不匹配 ' + JSON.stringify({panel: p.location, record: r.location, source: r.locationSource, want: expected.location}).slice(0, 400));
    return true;
  }
  function validateReceipt(v) {
    if (!v || v.schemaVersion !== 2 || v.kind !== 'boss_visible_batch') throw new Error('缺少BOSS schema2回执');
    const b = v.batch;
    config(b);
    if (typeof b.id !== 'string' || !b.id || !Number.isInteger(b.ownerTabId) || b.ownerTabId < 0 || !b.extensionVersion || b.status !== 'done' || b.stopReason || !Array.isArray(v.records) || v.records.length < 1 || v.records.length > 2 || b.recordCount !== v.records.length) throw new Error('BOSS回执不是成功1–2条批次');
    if (b.maxJobs !== 2 || b.minIntervalMs !== intervalMs) throw new Error('BOSS批次预算不匹配');
    const start = Date.parse(b.startedAt), end = Date.parse(b.endedAt), exp = Date.parse(b.exportedAt);
    if (![start,end,exp].every(Number.isFinite) || end < start || exp < end) throw new Error('BOSS批次时间无效');
    const evidence = listingEvidence(b.listingEvidence, b), evidenceAt = Date.parse(evidence.at);
    if (evidenceAt < start || evidenceAt > end) throw new Error('BOSS列表证据不在批次时间内');
    if (!Array.isArray(b.selectedJobs) || b.selectedJobs.length !== v.records.length || new Set(b.selectedJobs.map(j => jobUrl(j.url))).size !== v.records.length) throw new Error('BOSS岗位计划不完整或重复');
    const actions = b.actions;
    if (!Array.isArray(actions) || actions.filter(a => a.kind === 'search').length !== 1) throw new Error('必须有且仅有一次BOSS搜索动作');
    const allowed = new Set(['open-home','keyword-input','search','city-open','city-letter','city-select','job-click']);
    let last = null;
    for (const a of actions) {
      const at = Date.parse(a.at);
      if (!allowed.has(a.kind) || !Number.isFinite(at) || at < start || at > end || (last !== null && at - last < intervalMs)) throw new Error('BOSS网站动作类型或间隔无效');
      last = at;
      if (!validUrl(a.href)) throw new Error('BOSS动作不在搜索页');
      if (a.kind === 'job-click') {
        if (a.href !== evidence.href || !b.selectedJobs.some(j => jobUrl(j.url) === jobUrl(a.jobUrl))) throw new Error('BOSS点击不属于本批列表或岗位');
      }
    }
    if (Date.parse(actions.find(a => a.kind === 'search').at) > evidenceAt) throw new Error('BOSS列表证据早于搜索');
    const replay = {...b, records: []};
    for (const r of v.records) {
      const c = r.searchContext, at = Date.parse(r.observedAt);
      if (!c || c.batchId !== b.id || c.city !== b.city || c.keyword !== b.keyword || c.listingHref !== evidence.href || !['current_panel','clicked_panel'].includes(c.captureMode)) throw new Error('BOSS记录批次上下文不匹配');
      validateRecord(r, replay);
      if (at < evidenceAt) throw new Error('BOSS记录早于列表证据');
      const prior = actions.filter(a => Date.parse(a.at) <= at).at(-1);
      if (!prior || at - Date.parse(prior.at) < intervalMs) throw new Error('BOSS面板观察未等待15秒');
      if (c.captureMode === 'clicked_panel' && !actions.some(a => a.kind === 'job-click' && jobUrl(a.jobUrl) === jobUrl(r.url) && Date.parse(a.at) <= at - intervalMs)) throw new Error('BOSS缺少对应先行点击动作');
      replay.records.push(r);
    }
    return v;
  }
  const receipt = (run, exportedAt) => ({schemaVersion: 2, kind: 'boss_visible_batch', batch: {
    id: run.id, ownerTabId: run.ownerTabId, extensionVersion: run.extensionVersion,
    city: run.city, keyword: run.keyword, status: run.status, stopReason: run.stopReason || null,
    startedAt: run.startedAt, endedAt: run.endedAt, exportedAt, recordCount: run.records.length,
    maxJobs: 2, minIntervalMs: intervalMs, selectedJobs: run.jobs, listingEvidence: run.evidence, actions: run.actions,
  }, records: run.records});
  return {cities, keywords, intervalMs, config, listingEvidence, jobUrl, belongs, validateRecord, validateReceipt, receipt};
}
export const bossBatchPolicy = createBossBatchPolicy();
