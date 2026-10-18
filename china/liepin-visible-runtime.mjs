// 自包含 DOM 适配器；只读可见 DOM，唯一写操作由持久化动作许可触发。
export function createLiepinVisibleDom({window, document, location, history, extractPage, policy, now = () => Date.now()}) {
  const hosts = ['www.liepin.com', 'liepin.com', 'c.liepin.com'];
  const listPath = /^\/zhaopin\/?$/;
  const visible = e => !!e && e.isConnected !== false && !!e.getClientRects().length && window.getComputedStyle(e).visibility !== 'hidden' && window.getComputedStyle(e).display !== 'none';
  const text = e => visible(e) ? String(e.innerText || '').trim() : '';
  const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
  function safeUrl(value) {
    try { const u = new URL(value, location.href); return u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port ? u : null; } catch { return null; }
  }
  function jobUrl(value) { const u = safeUrl(value); return u && /^\/(?:job|a)\/\d+\.shtml$/.test(u.pathname) ? 'https://www.liepin.com' + u.pathname : null; }
  function cityDialog() {
    const roots = all(document, '[role="dialog"],.ant-modal,.ant-modal-content,[class*="modal"],[class*="Modal"]');
    const input = all(document, 'input[placeholder="搜索城市"]')[0];
    if (input) { let parent = input.parentElement; for (let i = 0; parent && i < 5; i++, parent = parent.parentElement) if (text(parent).includes('请选择城市')) roots.push(parent); }
    return roots.filter(e => text(e).includes('请选择城市') && all(e, 'input[placeholder="搜索城市"]').length === 1).sort((a,b) => text(a).length - text(b).length)[0] || null;
  }
  function searchInput() {
    for (const selector of ['input[name="key"]', 'input[placeholder*="职位"]', 'input[placeholder*="搜索"]']) {
      const inputs = all(document, selector).filter(e => e.getAttribute('placeholder') !== '搜索城市' && e.type !== 'hidden');
      if (inputs.length === 1) return inputs[0];
    }
    return null;
  }
  function searchButton(input = searchInput()) {
    const root = input?.closest('form') || document;
    const candidates = all(root, 'button[type="submit"],input[type="submit"],button.btn-search,.btn-search');
    if (candidates.length === 1) return candidates[0];
    const exact = all(root, 'button,a,[role="button"]').filter(e => text(e) === '搜索');
    return exact.length === 1 ? exact[0] : null;
  }
  function exactControl(root, label) {
    const candidates = all(root, 'button,a,li,[role="option"],[role="menuitem"],span,div').filter(e => text(e) === label);
    const leaves = candidates.filter(e => !candidates.some(other => other !== e && e.contains(other)));
    return leaves.length === 1 ? leaves[0] : null;
  }
  function cityRow() {
    const labels = all(document, 'span,div,label,dt').filter(e => text(e) === '城市');
    const roots = [];
    for (const label of labels) {
      let parent = label.parentElement;
      for (let i = 0; parent && i < 3; i++, parent = parent.parentElement) {
        if (text(parent).length < 600 && exactControl(parent, '其他')) { roots.push(parent); break; }
      }
    }
    return roots.sort((a,b) => text(a).length - text(b).length)[0] || null;
  }
  function selectedCity() {
    const labels = all(document, 'span,div,p,strong,label').filter(e => /^已选条件\s*[：:]?$/.test(text(e)));
    for (const label of labels) {
      let root = label.parentElement;
      for (let depth = 0; root && depth < 3; depth++, root = root.parentElement) {
        const quote = text(root); if (!quote || quote.length > 320) break;
        const values = all(root, 'span,a,li,button,div').map(text).map(value => value.match(/^(上海|杭州|南京|福州)(?:市)?(?:\s*[×✕])?$/)?.[1]).filter(Boolean);
        const unique = [...new Set(values)];
        if (unique.length === 1) return {selectedCity: unique[0], cityQuote: quote};
        if (unique.length > 1) return {selectedCity: '', cityQuote: quote};
      }
    }
    return {selectedCity: '', cityQuote: ''};
  }
  function parsed(kind) {
    try { return extractPage({platform: 'liepin', kind}); } catch { return {status: 'extraction_failed', jobs: []}; }
  }
  function snapshot(batch) {
    const href = location.href, u = safeUrl(href), input = searchInput(), dialog = cityDialog();
    const listing = !!u && listPath.test(u.pathname);
    const extracted = parsed(listing ? 'listing' : 'detail');
    const state = parsed('state');
    let gate = state.status === 'challenge' || state.status === 'login_required' ? state.status : 'ok';
    if (['challenge','login_required','empty','closed','source_insufficient'].includes(extracted.status)) gate = extracted.status;
    if (/captcha|security|passport|login/i.test(location.pathname) || location.hostname === 'safe.liepin.com' || location.hostname === 'wow.liepin.com') gate = 'challenge_or_login';
    const city = selectedCity();
    const cityInput = dialog ? all(dialog, 'input[placeholder="搜索城市"]')[0] : null;
    const row = cityRow();
    const cityOption = exactControl(dialog || row || {querySelectorAll: () => []}, batch.city);
    const jobs = Array.isArray(extracted.jobs) ? extracted.jobs.map(j => ({url: j.url, title: j.title, location: j.location || '', company: j.company || '', listingText: j.listingText || ''})) : [];
    const expected = batch.jobs[batch.records.length];
    let card = null;
    if (expected) {
      const matching = jobs.filter(j => jobUrl(j.url) === jobUrl(expected.url));
      if (matching.length === 1) card = matching[0];
    }
    let record = null;
    if (!listing && extracted.status === 'ok' && extracted.job) {
      const j = extracted.job;
      record = {...j, platform: 'liepin', url: jobUrl(href), complete: true, captureMethod: 'browser_extension', observedAt: new Date(now()).toISOString(), sourceText: j.description || '', searchContext: {batchId: batch.batchId, city: batch.city, keyword: batch.keyword, listingHref: batch.evidence?.href}};
    }
    return {href, blank: !String(document.body?.innerText || '').trim(), gate, inputValue: input?.value ?? '', searchInput: !!input, searchButton: !!searchButton(input), ...city, cityParam: u?.searchParams.get('city') || '', cityDialog: !!dialog, cityInput: !!cityInput, cityInputValue: cityInput?.value ?? '', otherControl: !!row && !!exactControl(row, '其他'), exactCityOption: !!cityOption, jobs, card, record};
  }
  function anchors(expected) {
    const matches = all(document, 'a[href*="/job/"],a[href*="/a/"]').filter(a => jobUrl(a.getAttribute('href')) === jobUrl(expected.url));
    if (matches.length !== 1) throw new Error('岗位可见链接缺失或不唯一');
    return matches[0];
  }
  function nativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('缺少原生输入框 value setter');
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    input.dispatchEvent(new window.Event('change', {bubbles: true}));
  }
  function prepare(kind, batch) {
    const initial = snapshot(batch), href = location.href;
    let element;
    if (kind === 'keyword-input') element = searchInput();
    if (kind === 'search') element = searchButton();
    if (kind === 'city-other') { const row = cityRow(); element = row && exactControl(row, '其他'); }
    if (kind === 'city-input') { const dialog = cityDialog(); element = dialog && all(dialog, 'input[placeholder="搜索城市"]')[0]; }
    if (kind === 'city-select') element = exactControl(cityDialog() || cityRow() || {querySelectorAll: () => []}, batch.city);
    if (kind === 'job-click') element = anchors(batch.jobs[batch.records.length]);
    if (kind !== 'history-back' && !visible(element)) throw new Error('动作对应的可见控件缺失');
    return {snapshot: initial, perform() {
      if (location.href !== href || (element && !visible(element))) throw new Error('许可期间 DOM 或文档变化');
      const current = snapshot(batch);
      if (current.blank || current.gate !== 'ok') throw new Error('许可期间页面出现登录、挑战或空白');
      if (kind.startsWith('city-') || kind === 'job-click') {
        const u=safeUrl(current.href);
        if (!u || u.searchParams.get('key') !== batch.keyword || current.inputValue !== batch.keyword) throw new Error('许可期间关键词身份变化');
        if (kind === 'job-click' && (current.href !== batch.evidence.href || current.selectedCity !== batch.city || !current.cityParam)) throw new Error('许可期间城市或列表身份变化');
      }
      if (kind === 'job-click') {
        const expected = batch.jobs[batch.records.length];
        if (anchors(expected) !== element || !current.card || current.card.title !== expected.title || current.card.location !== expected.location) throw new Error('许可期间岗位身份变化');
      }
      if (kind === 'keyword-input') return nativeValue(element, batch.keyword);
      if (kind === 'city-input') return nativeValue(element, batch.city);
      if (kind === 'search' && (current.inputValue !== batch.keyword || searchButton() !== element)) throw new Error('许可期间搜索框或按钮变化');
      if (kind === 'city-select' && !current.exactCityOption) throw new Error('许可期间城市匹配项变化');
      if (kind === 'history-back') return history.back();
      if (element.tagName === 'A') {
        if (kind === 'job-click' && !jobUrl(element.getAttribute('href'))) throw new Error('岗位链接不安全');
        element.removeAttribute('target');
      }
      // 原生 click 仅一次；无 dispatch(click)、Enter、自动重试或构造导航。
      element.click();
    }};
  }
  let panel;
  function show(message) {
    if (!panel && document.documentElement) {
      const host = document.createElement('div'); host.id = 'career-ops-liepin-visible-status';
      const shadow = host.attachShadow({mode: 'closed'});
      panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;right:18px;top:86px;z-index:2147483647;background:#fff7ed;color:#172033;border:1px solid #ff7a00;border-radius:10px;padding:12px;max-width:330px;white-space:pre-wrap;font:14px/1.45 system-ui;box-shadow:0 8px 28px #0002';
      shadow.append(panel); document.documentElement.append(host);
    }
    if (panel) panel.textContent = message;
  }
  return {snapshot, prepare, show};
}

// 单任务递归定时器；后台是唯一权威，等待时每轮重新读取持久化状态。
export function createLiepinVisibleRuntime({chrome, dom, href, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id)}) {
  let busy = false, timer = null, disposed = false, current = null;
  const send = message => chrome.runtime.sendMessage(message);
  const base = batch => ({batchId: batch.batchId, revision: batch.revision, stage: batch.stage, href: href()});
  async function halt(batch, reason) {
    const result = await send({type: 'HALT', ...base(batch), reason});
    current = result?.batch || current; dom.show('批次硬停：' + reason);
  }
  async function tick() {
    if (busy || disposed) return {skipped: true};
    busy = true;
    try {
      const hello = await send({type: 'HELLO', href: href()});
      if (!hello?.owner) { dom.show('非本批 owner 标签：不执行任何网站动作。'); return {owner: false}; }
      current = hello.batch;
      if (!hello.ok || current?.status !== 'running') { dom.show('批次已停止或完成；刷新不会重新开始。'); return {terminal: true}; }
      const batch = current, s = dom.snapshot(batch);
      dom.show('批次：' + batch.batchId + '\n' + batch.city + ' / ' + batch.keyword + '\n阶段：' + batch.stage + '\n本批：' + batch.records.length + '/' + (batch.jobs.length || 2));
      if (s.blank || s.gate !== 'ok') { await halt(batch, s.blank ? '可见页面空白' : '页面门槛：' + s.gate); return {halted: true}; }
      const awaitStages = ['search-await','city-dialog-await','city-await','job-await','list-await','city-input-set'];
      if (awaitStages.includes(batch.stage) && now() - Date.parse(batch.stageSince) > 45000) { await halt(batch, '等待当前阶段页面证据超时；不重复点击'); return {halted: true}; }
      const observeStages = ['opening','search-await','city-dialog-await','city-await','listing-ready','job-await','list-await'];
      if (observeStages.includes(batch.stage) || (batch.stage === 'city-ready' && s.selectedCity === batch.city)) {
        const result = await send({type: 'OBSERVE', ...base(batch), snapshot: s});
        current = result?.batch || current;
        if (result?.halted) dom.show('批次硬停：' + result.message);
        return result;
      }
      let kind;
      if (batch.stage === 'keyword-ready') kind = 'keyword-input';
      else if (batch.stage === 'keyword-filled') kind = 'search';
      else if (batch.stage === 'city-ready') kind = batch.city === '福州' || !s.exactCityOption ? 'city-other' : 'city-select';
      else if (batch.stage === 'city-input-ready') kind = 'city-input';
      else if (batch.stage === 'city-input-set') { if (!s.exactCityOption) return {waiting: true}; kind = 'city-select'; }
      else if (batch.stage === 'job-ready') kind = 'job-click';
      else if (batch.stage === 'record-saved') kind = 'history-back';
      else { await halt(batch, '未知或旧阶段，禁止自动恢复'); return {halted: true}; }
      const prepared = dom.prepare(kind, batch);
      const result = await send({type: 'RESERVE', ...base(batch), kind, snapshot: prepared.snapshot, ...(kind === 'job-click' ? {jobUrl: batch.jobs[batch.records.length]?.url} : {})});
      current = result?.batch || current;
      if (!result?.ok) {
        if (result?.waitMs) dom.show('阶段：' + batch.stage + '\n等待至少15秒动作间隔，剩余 ' + Math.ceil(result.waitMs / 1000) + ' 秒；每轮刷新后台状态。');
        return result;
      }
      // 停止按钮可能在许可返回后生效；再次核对持久化许可后才触发 DOM。
      const check = await send({type: 'CHECK_ACTION', ...base(result.batch), token: result.token});
      current = check?.batch || current;
      if (!check?.ok) return {stale: true};
      try { prepared.perform(); }
      catch (error) { await halt(check.batch || result.batch, error.message); return {halted: true}; }
      return {ok: true, action: kind};
    } catch (error) {
      if (current?.status === 'running') await halt(current, error.message);
      else dom.show('本地扩展错误，未发送网站动作：' + error.message);
      return {error: error.message};
    } finally { busy = false; }
  }
  function start() {
    if (timer != null || disposed) return;
    const run = async () => { timer = null; await tick(); if (!disposed) timer = schedule(run, 800); };
    timer = schedule(run, 0);
  }
  function dispose() { disposed = true; if (timer != null) cancel(timer); timer = null; }
  return {tick, start, dispose, state: () => current};
}
