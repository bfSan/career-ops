// 自包含工厂：构建器将函数序列化进 MV3 worker；测试只使用内存 Chrome mock。
export function createLiepinVisibleWorker({chrome, policy, now = () => Date.now(), random = () => Math.random()}) {
  const HOME = 'https://www.liepin.com/zhaopin/';
  const BATCH_KEY = 'careerOpsLiepinVisibleBatchV2';
  const LAST_KEY = 'careerOpsLiepinVisibleLastActionAtV2';
  const VERSION = '2.0.0';
  const hosts = ['www.liepin.com', 'liepin.com', 'c.liepin.com'];
  const iso = () => new Date(now()).toISOString();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const get = keys => chrome.storage.local.get(keys);
  const set = value => chrome.storage.local.set(value);
  let serial = Promise.resolve();
  const enqueue = task => {
    const result = serial.then(task);
    serial = result.catch(() => {});
    return result;
  };
  function url(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port && hosts.includes(u.hostname) ? u : null;
    } catch { return null; }
  }
  const listing = value => { const u = url(value); return u && /^\/zhaopin\/?$/.test(u.pathname) ? u : null; };
  const job = value => { const u = url(value); return u && /^\/(?:job|a)\/\d+\.shtml$/.test(u.pathname) ? 'https://www.liepin.com' + u.pathname : null; };
  function haltUrl(value) {
    try { const u = new URL(value); return u.hostname === 'safe.liepin.com' || /captcha|security|passport|login/i.test(u.pathname) || u.hostname === 'wow.liepin.com'; }
    catch { return false; }
  }
  function belongs(location, city) {
    // “上海”不能由公司名称或“非上海”猜测；地点必须以目标市开头。
    return String(location || '').trim().startsWith(city);
  }
  async function batch() { return (await get([BATCH_KEY]))[BATCH_KEY] || null; }
  async function persist(value) { await set({[BATCH_KEY]: value}); return value; }
  function advance(value, patch) { return {...value, ...patch, revision: (Number.isSafeInteger(value.revision) ? value.revision : 0) + 1, updatedAt: iso()}; }
  async function stop(value, reason) {
    if (!value || value.status !== 'running') return value;
    return persist(advance(value, {status: 'stopped', stage: 'stopped', stopReason: String(reason || '用户停止'), endedAt: iso(), pendingAction: null}));
  }
  const extensionUrl = name => chrome.runtime.getURL(name);
  function isControl(sender) {
    return !sender?.tab?.url?.startsWith('https:') && sender?.url === extensionUrl('control.html') && (sender.frameId == null || sender.frameId === 0);
  }
  function isPage(value, sender) {
    return value && value.status === 'running' && Number.isInteger(sender?.tab?.id) && sender.tab.id === value.ownerTabId && (sender.frameId == null || sender.frameId === 0) && !!sender.documentId;
  }
  async function livePage(value, sender, message, {compare = true} = {}) {
    if (!isPage(value, sender)) throw new Error('非 owner 主文档拒绝');
    if (message.batchId !== value.batchId) throw new Error('旧批次消息拒绝');
    if (compare && (message.revision !== value.revision || message.stage !== value.stage)) throw new Error('阶段锁或旧版本冲突');
    if (value.documentId !== sender.documentId) throw new Error('旧页面文档拒绝');
    const tab = await chrome.tabs.get(value.ownerTabId);
    if (!tab || tab.id !== value.ownerTabId || tab.url !== message.href || sender.url !== message.href) throw new Error('owner 页面 URL 已变化');
    if (!url(message.href) || haltUrl(message.href)) throw new Error('owner 页面已进入登录、挑战或非猎聘地址');
    return tab;
  }
  function exactKeyword(snapshot, target) {
    const u = listing(snapshot.href);
    if (!u || u.searchParams.getAll('key').length !== 1 || u.searchParams.get('key') !== target.keyword || snapshot.inputValue !== target.keyword) throw new Error('URL decoded key 和可见搜索框必须精确等于本批关键词');
    return u;
  }
  function evidence(snapshot, target) {
    const u = exactKeyword(snapshot, target);
    if (!u.searchParams.get('city') || snapshot.selectedCity !== target.city || !snapshot.cityQuote || snapshot.cityParam !== u.searchParams.get('city')) throw new Error('缺少当前页面已选条件的真实城市和 city 参数证据');
    return policy.listingEvidence({...snapshot, at: iso()}, target);
  }
  function sameListing(snapshot, value) {
    evidence(snapshot, value);
    if (!value.evidence || snapshot.href !== value.evidence.href) throw new Error('列表地址或筛选身份变化');
  }
  function safeSnapshot(snapshot, value) {
    if (!snapshot || !snapshot.href || snapshot.blank === true) throw new Error('可见页面空白，硬停');
    if (snapshot.gate && snapshot.gate !== 'ok') throw new Error('页面门槛：' + snapshot.gate);
    if (!url(snapshot.href) || haltUrl(snapshot.href)) throw new Error('页面进入挑战、登录或不受信任地址');
    if (snapshot.href !== value.href) { /* 导航由阶段确认；绝不据旧 state 推断页面。 */ }
  }
  const actionStages = {
    'keyword-input': {'keyword-ready': 'keyword-filled'},
    search: {'keyword-filled': 'search-await'},
    'city-other': {'city-ready': 'city-dialog-await'},
    'city-input': {'city-input-ready': 'city-input-set'},
    'city-select': {'city-ready': 'city-await', 'city-input-set': 'city-await'},
    'job-click': {'job-ready': 'job-await'},
    'history-back': {'record-saved': 'list-await'},
  };
  function waitMs(last) { return last ? Math.max(0, policy.intervalMs - (now() - Date.parse(last))) : 0; }
  function navigationExpected(value, href) {
    if (value.stage === 'opening') return href === HOME;
    if (value.stage === 'search-await') { try { return exactKeyword({href, inputValue: value.keyword}, value); } catch { return false; } }
    if (value.stage === 'city-await') { const u = listing(href); return !!u && u.searchParams.get('key') === value.keyword && !!u.searchParams.get('city'); }
    if (value.stage === 'job-await') return job(href) === job(value.jobs[value.records.length]?.url);
    if (value.stage === 'list-await') return href === value.evidence?.href;
    return false;
  }
  async function handle(message = {}, sender = {}) {
    let value = await batch();
    if (message.type === 'CONTROL_STATE') {
      if (!isControl(sender)) return {ok: false, message: '只允许本地控制页读取'};
      return {ok: true, batch: clone(value)};
    }
    if (message.type === 'START') {
      if (!isControl(sender)) return {ok: false, message: '只允许可见本地控制页开始'};
      policy.config(message);
      if (value?.status === 'running') return {ok: false, message: '已有批次运行，禁止重入', batch: clone(value)};
      const remaining = waitMs((await get([LAST_KEY]))[LAST_KEY]);
      if (remaining) return {ok: false, waitMs: remaining, message: '不同批次共享15秒网站动作间隔', batch: clone(value)};
      const at = iso(), id = 'liepin-' + now().toString(36) + '-' + random().toString(36).slice(2, 10);
      value = {batchId: id, id, ownerTabId: null, city: message.city, keyword: message.keyword, version: VERSION, extensionVersion: VERSION, status: 'running', stage: 'opening', revision: 1, documentId: null, stageSince: at, startedAt: at, endedAt: null, stopReason: null, evidence: null, jobs: [], records: [], actions: [{kind: 'open-home', href: HOME, at}], pendingAction: null};
      // 先存导航意图和全局时间，再且只再新开一个无参列表标签。
      await set({[BATCH_KEY]: value, [LAST_KEY]: at});
      try {
        const tab = await chrome.tabs.create({url: HOME, active: true});
        if (!Number.isInteger(tab?.id)) throw new Error('新标签没有有效身份');
        value = advance(value, {ownerTabId: tab.id}); await persist(value);
      } catch (error) { value = await stop(value, '打开 owner 标签失败：' + error.message); }
      return {ok: value.status === 'running', batch: clone(value)};
    }
    if (message.type === 'CONTROL_STOP') {
      if (!isControl(sender)) return {ok: false, message: '只允许控制页停止'};
      return {ok: true, batch: clone(await stop(value, message.reason || '用户在控制页停止'))};
    }
    if (message.type === 'EXPORT' || message.type === 'AUTO_EXPORT') {
      if (!isControl(sender)) return {ok: false, message: '只允许控制页导出'};
      if (!value || value.status !== 'done' || value.stopReason) return {ok: false, message: '只可导出成功完成的本批1–2条'};
      if (message.type === 'AUTO_EXPORT' && value.exportedBatchId === value.batchId) return {ok: false, already: true, batch: clone(value)};
      const receipt = policy.receipt(value, iso());
      policy.validateReceipt(receipt);
      if (message.type === 'AUTO_EXPORT') { value = advance(value, {exportedBatchId: value.batchId}); await persist(value); }
      return {ok: true, receipt: clone(receipt), batch: clone(value)};
    }
    if (message.type === 'HELLO') {
      if (!isPage(value, sender)) return {ok: false, owner: false};
      if (value.version !== VERSION || !Number.isSafeInteger(value.revision) || !Array.isArray(value.jobs) || !Array.isArray(value.records) || !Array.isArray(value.actions) || value.id !== value.batchId) return {ok:false,owner:true,batch:clone(await stop(value,'旧格式或损坏的批次状态，禁止自动恢复'))};
      const tab = await chrome.tabs.get(value.ownerTabId);
      if (!tab || tab.url !== sender.url || message.href !== sender.url) return {ok: false, owner: false};
      if (!url(tab.url) || haltUrl(tab.url)) return {ok: false, owner: true, batch: clone(await stop(value, 'owner 标签进入挑战、登录或非猎聘地址'))};
      if (value.documentId && value.documentId !== sender.documentId && !navigationExpected(value, tab.url)) return {ok: false, owner: true, batch: clone(await stop(value, '非预期刷新或文档身份变化，必须显式新开始'))};
      if (value.documentId !== sender.documentId) { value = advance(value, {documentId: sender.documentId}); await persist(value); }
      return {ok: true, owner: true, batch: clone(value)};
    }
    if (!isPage(value, sender)) return {ok: false, owner: false, message: '非 owner 标签或终止批次拒绝'};
    try {
      await livePage(value, sender, message);
    } catch (error) { return {ok: false, stale: true, message: error.message}; }
    if (message.type === 'HALT') return {ok: true, batch: clone(await stop(value, message.reason))};
    if (message.type === 'CHECK_ACTION') {
      if (!value.pendingAction || value.pendingAction.token !== message.token || value.pendingAction.documentId !== sender.documentId || value.pendingAction.dispatched) return {ok:false,message:'动作许可已消费或不属于当前文档'};
      value=advance(value,{pendingAction:{...value.pendingAction,dispatched:true}});await persist(value);
      return {ok:true,batch:clone(value)};
    }
    try {
      safeSnapshot(message.snapshot, value);
      if (message.snapshot.href !== message.href) throw new Error('快照与当前文档不一致');
      if (message.type === 'OBSERVE') {
        const s = message.snapshot;
        let patch;
        if (value.stage === 'opening') {
          if (s.href !== HOME || !listing(s.href)) throw new Error('开始页不是无参数列表');
          patch = {stage: 'keyword-ready'};
        } else if (value.stage === 'search-await') {
          const u = listing(s.href);
          if (!u) throw new Error('搜索后未停留猎聘列表');
          if (!u.searchParams.has('key')) return {ok: true, waiting: true, batch: clone(value)};
          exactKeyword(s, value); patch = {stage: 'city-ready'};
        } else if (value.stage === 'city-dialog-await') {
          exactKeyword(s, value);
          if (!s.cityDialog || !s.cityInput) return {ok: true, waiting: true, batch: clone(value)};
          patch = {stage: 'city-input-ready'};
        } else if (value.stage === 'city-await' || value.stage === 'city-ready') {
          exactKeyword(s, value);
          if (!s.selectedCity) return {ok: true, waiting: true, batch: clone(value)};
          patch = {evidence: evidence(s, value), stage: 'listing-ready'};
        } else if (value.stage === 'listing-ready') {
          sameListing(s, value);
          if (!Array.isArray(s.jobs) || s.jobs.length < 1) throw new Error('列表没有可见岗位');
          const jobs = s.jobs.slice(0, 2).map(candidate => {
            if (!job(candidate.url) || !String(candidate.title || '').trim()) throw new Error('岗位地址或标题无效');
            if (!belongs(candidate.location, value.city)) throw new Error('列表岗位地点不属于目标城市，停止而非跳过');
            return {...candidate, canonicalUrl: job(candidate.url)};
          });
          if (new Set(jobs.map(j => j.canonicalUrl)).size !== jobs.length) throw new Error('岗位计划重复');
          patch = {jobs, stage: 'job-ready'};
        } else if (value.stage === 'job-await') {
          const expected = value.jobs[value.records.length];
          if (listing(s.href)) return {ok: true, waiting: true, batch: clone(value)};
          if (!expected || job(s.href) !== job(expected.url)) throw new Error('详情 URL/path 与待采岗位不匹配');
          const record = s.record;
          if (!record) return {ok: true, waiting: true, batch: clone(value)};
          if (record.title !== expected.title || !belongs(record.location, value.city)) throw new Error('详情标题或实际地点身份变化，停止而非跳过');
          if (job(record.url) !== job(s.href)) throw new Error('详情记录 URL 与文档不符');
          if (!record.searchContext || record.searchContext.batchId !== value.batchId || record.searchContext.city !== value.city || record.searchContext.keyword !== value.keyword || record.searchContext.listingHref !== value.evidence.href) throw new Error('记录批次上下文不匹配');
          policy.validateRecord(record, value);
          const records = [...value.records, record];
          patch = records.length === value.jobs.length ? {records, status: 'done', stage: 'done', endedAt: iso(), pendingAction: null} : {records, stage: 'record-saved'};
        } else if (value.stage === 'list-await') {
          if (job(s.href)) return {ok: true, waiting: true, batch: clone(value)};
          sameListing(s, value); patch = {stage: 'job-ready'};
        } else return {ok: false, message: '当前阶段不接受 DOM 推进'};
        value = advance(value, {...patch, pendingAction: null, stageSince: iso()}); await persist(value);
        return {ok: true, batch: clone(value)};
      }
      if (message.type === 'RESERVE') {
        const nextStage = actionStages[message.kind]?.[value.stage];
        if (!nextStage) return {ok: false, message: '阶段锁拒绝重复或非法网站动作'};
        const s = message.snapshot;
        if (message.kind === 'keyword-input') { if (s.href !== HOME || !s.searchInput) throw new Error('关键词输入前不是无参列表或可见框缺失'); }
        if (message.kind === 'search') { if (!listing(s.href) || s.inputValue !== value.keyword || !s.searchButton) throw new Error('点击搜索前可见关键词或按钮未确认'); }
        if (message.kind.startsWith('city-')) {
          exactKeyword(s, value);
          if (message.kind === 'city-other' && !s.otherControl) throw new Error('未找到可见“其他”城市入口');
          if (message.kind === 'city-input' && (!s.cityDialog || !s.cityInput)) throw new Error('未确认请选择城市弹窗和搜索城市输入框');
          if (message.kind === 'city-select' && (!s.exactCityOption || (value.city === '福州' && (value.stage !== 'city-input-set' || s.cityInputValue !== '福州')))) throw new Error('福州必须经其他→弹窗搜索城市→精确匹配项');
        }
        if (message.kind === 'job-click') {
          sameListing(s, value);
          const expected = value.jobs[value.records.length];
          if (!expected || job(message.jobUrl) !== job(expected.url) || job(s.card?.url) !== job(expected.url) || s.card?.title !== expected.title || s.card?.location !== expected.location || !belongs(s.card?.location, value.city)) throw new Error('岗位卡片 URL/title/location 身份变化');
        }
        if (message.kind === 'history-back' && job(s.href) !== job(value.records.at(-1)?.url)) throw new Error('返回前详情身份变化');
        const remaining = waitMs((await get([LAST_KEY]))[LAST_KEY]);
        if (remaining) return {ok: false, waitMs: remaining, batch: clone(value)};
        const at = iso(), token = value.batchId + ':' + (value.revision + 1);
        const action = {kind: message.kind, href: message.href, at, ...(message.jobUrl ? {jobUrl: message.jobUrl} : {})};
        value = advance(value, {stage: nextStage, stageSince: at, actions: [...value.actions, action], pendingAction: {token, kind: message.kind, href: message.href, documentId: sender.documentId}});
        await set({[BATCH_KEY]: value, [LAST_KEY]: at});
        return {ok: true, token, batch: clone(value)};
      }
      return {ok: false, message: '未知页面消息'};
    } catch (error) {
      value = await stop(value, error.message);
      return {ok: false, halted: true, message: error.message, batch: clone(value)};
    }
  }
  const dispatch = (message, sender) => enqueue(() => handle(message, sender));
  function install() {
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      dispatch(message, sender).then(reply, error => reply({ok: false, message: error.message})); return true;
    });
    chrome.tabs.onUpdated.addListener((tabId, change, tab) => { void enqueue(async () => {
      const value = await batch(); if (!value || value.status !== 'running' || tabId !== value.ownerTabId) return;
      const href = change.url || tab?.url;
      if (href && (haltUrl(href) || !url(href))) await stop(value, 'owner 标签 URL 进入挑战、登录或非猎聘地址');
      else if (change.url && !navigationExpected(value, href) && value.documentId && href !== value.evidence?.href && job(href) !== job(value.jobs[value.records.length]?.url)) await stop(value, 'owner 标签 URL 身份变化');
    }); });
    chrome.tabs.onRemoved.addListener(tabId => { void enqueue(async () => { const value = await batch(); if (value?.ownerTabId === tabId) await stop(value, 'owner 标签已关闭'); }); });
    // 不注册生命周期自动动作；安装、浏览器启动、控制页刷新均无站点动作。
  }
  return {dispatch, install, idle: () => serial, keys: {batch: BATCH_KEY, lastAction: LAST_KEY}};
}
