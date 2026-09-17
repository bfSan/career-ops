// Domestic platform adapters. Read rendered DOM only; job text is untrusted data.
export {normalizeSalary} from './salary.mjs';
import {applySalaryDefaults} from './market-defaults.mjs';
import {parseCompensation} from '../compensation.mjs';
import {parsePostingDate} from '../posting-dates.mjs';
export function buildObservationFacts(job,observedAt,defaults={}) {
  if(!job?.factInputs)return null;
  const {salary,dates}=job.factInputs;
  const raw=job.salaryText??job.salaryRaw??'';
  let compensation=raw?parseCompensation({raw,currency:salary.currency,period:salary.period,
    evidence:[...salary.evidence,...(job.salaryEvidence?[{field:'verifiedFont',quote:JSON.stringify(job.salaryEvidence)}]:[])]}):null;
  compensation=applySalaryDefaults(compensation,defaults);
  // Metadata supplies units, never replaces a conflicting visible salary.
  if(compensation?.status==='parsed'&&salary.structuredRange
    &&(compensation.min!==salary.structuredRange.min||compensation.max!==salary.structuredRange.max)){
    compensation=parseCompensation({...compensation,currency:null,period:null});
  }
  return {schemaVersion:1,
    compensation,
    dates:dates.map(input=>parsePostingDate({...input,observedAt,timezone:'Asia/Shanghai'})),
  };
}
const HOSTS = { boss: ['www.zhipin.com', 'zhipin.com'], liepin: ['www.liepin.com', 'liepin.com'], linkedin: ['www.linkedin.com','linkedin.com','cn.linkedin.com','hk.linkedin.com'] };

// Repair old list snapshots produced before the bracket-location DOM fix.
// Only the separate visible location block is admissible, never company/title text.
export function normalizeListingCard(card) {
  if(!card.key?.startsWith('liepin:')||card.location?.trim())return {...card};
  const matches=[...String(card.listingText||'').matchAll(/(?:^|\n)\s*【\s*\n([^\n【】]+)\n\s*】\s*(?=\n|$)/g)];
  const values=[...new Set(matches.map(m=>m[1].trim()))];
  if(values.length!==1)return {...card};
  return {...card,location:values[0],locationRepair:{field:'listingText',quote:matches[0][0].trim(),reason:'separate_visible_location_block'}};
}

export function platformUrl(platform, value) {
  const hosts = HOSTS[platform];
  if (!hosts) throw new Error(`Unsupported platform: ${platform}`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error(`Expected an HTTPS ${platform} URL without credentials or a custom port`);
  }
  return url;
}

// Liepin's observed account gate lives outside its job/search host. Restrict
// this exception to login; it must never become an accepted JD or search URL.
export function validateLoginUrl(platform,value) {
  const url=new URL(value);
  if(platform==='liepin'&&url.protocol==='https:'&&url.hostname==='wow.liepin.com'
    &&url.pathname==='/t1012695/4410f519.html'&&!url.username&&!url.password&&!url.port)return url;
  return platformUrl(platform,value);
}

export function loginUrl(platform,query='Agent') {
  if(platform==='boss')return 'https://www.zhipin.com/web/user/';
  if(platform==='liepin')return 'https://wow.liepin.com/t1012695/4410f519.html';
  return searchUrl(platform,query);
}

export function jobIdentity(platform, value) {
  const url = platformUrl(platform, value);
  if(platform==='linkedin'){
    const match=url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/);
    if(!match)throw new Error('Unrecognized job detail URL');
    return {id:match[1],key:`linkedin:${match[1]}`,url:`https://www.linkedin.com/jobs/view/${match[1]}`};
  }
  const match = platform === 'boss'
    ? url.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)
    : url.pathname.match(/^\/(job|a)\/(\d+)\.shtml$/);
  if (!match) throw new Error('Unrecognized job detail URL');
  const id = platform === 'boss' ? match[1] : `${match[1]}-${match[2]}`;
  return { id, key: `${platform}:${id}`, url: `https://${HOSTS[platform][0]}${url.pathname}` };
}

export function searchUrl(platform, query) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('A nonempty query is required');
  const url = platformUrl(platform, platform === 'boss'
    ? 'https://www.zhipin.com/web/geek/jobs' : platform==='linkedin'?'https://www.linkedin.com/jobs/search/':'https://www.liepin.com/zhaopin/');
  url.searchParams.set(platform === 'boss' ? 'query' : platform==='linkedin'?'keywords':'key', query.trim());
  return url.href;
}

export function validateSearchUrl(platform, value) {
  const url = platformUrl(platform, value);
  const valid = platform === 'boss' ? /^\/web\/geek\/jobs?\/?$/.test(url.pathname) : platform==='linkedin'?/^\/jobs\/search\/?$/.test(url.pathname):/^\/zhaopin\/?$/.test(url.pathname);
  if (!valid) throw new Error('Use a platform search-results URL, not a profile/chat/detail URL');
  url.hash = '';
  return url.href;
}

// Self-contained because Playwright serializes this function into the page.
export function extractPage({ platform, kind, expected, sourceText }) {
  const visible = e => !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const text = e => visible(e) ? e.innerText.trim() : '';
  const pick = (root, selectors) => {
    for (const selector of selectors) {
      for (const el of root.querySelectorAll(selector)) { const value = text(el); if (value) return value; }
    }
    return '';
  };
  const noticeOnly = kind === 'notice' || kind === 'state';
  const body = kind === 'notice' ? String(sourceText || '') : document.body?.innerText || '';
  const path = kind === 'notice' ? '' : location.pathname;
  const result = noticeOnly ? {status:'ok'} : { url: location.href, title: document.title, status: 'extraction_failed', jobs: [] };
  if(platform==='linkedin'){
    // Public and signed-in views use separate DOM layouts. Read visible fields only.
    const lines=body.split(/\n+/).map(s=>s.trim());
    if(/\/(?:checkpoint|challenge)(?:\/|$)/i.test(path)||lines.some(s=>/^(?:Let.s do a quick security check|Verify (?:your identity|you are human)|Security verification)(?:[.! ]|$)/i.test(s)))return {...result,status:'challenge'};
    if(/\/(?:authwall|login|uas\/login)(?:\/|$)/i.test(path)||/sign in to (?:view|see|read) (?:the )?(?:full |complete )?(?:job|description)|登录(?:后)?查看完整/i.test(body))return {...result,status:'login_required'};
    const closed=lines.find(s=>/^(?:No longer accepting applications|This job is no longer available|This job has expired)[.!]?$/i.test(s));
    if(closed&&kind!=='state'&&kind!=='listing')return {...result,status:'closed',evidence:{field:'visibleText',quote:closed}};
    if(noticeOnly)return result;
    const fields=root=>({
      title:pick(root,['.base-search-card__title','.job-card-list__title','.job-card-list__title--link','.top-card-layout__title','.job-details-jobs-unified-top-card__job-title','h1']),
      company:pick(root,['.base-search-card__subtitle','.artdeco-entity-lockup__subtitle','.job-card-container__primary-description','.topcard__org-name-link','.topcard__flavor:not(.topcard__flavor--bullet)','.job-details-jobs-unified-top-card__company-name']),
      location:pick(root,['.job-search-card__location','.job-card-container__metadata-item','.topcard__flavor--bullet','.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text:first-child']),
      salaryRaw:pick(root,['.compensation__salary','.salary-main-rail__data-body','.job-search-card__salary-info','.salary']),
      experience:'',education:'',tags:[],advertised:false,qualityFlags:[],
    });
    if(kind==='listing'){
      const seen=new Set();
      for(const a of [...document.querySelectorAll('a[href*="/jobs/view/"]')].filter(visible)){
        let u;try{u=new URL(a.getAttribute('href'),location.href);}catch{continue;}
        const id=u.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1];
        if(!id||u.protocol!=='https:'||u.username||u.password||u.port||!['www.linkedin.com','linkedin.com','cn.linkedin.com','hk.linkedin.com'].includes(u.hostname)||seen.has(id))continue;
        const card=a.closest('.base-card,.job-search-card,.jobs-search-results__list-item,.job-card-container,li')||a;
        const job=fields(card);job.title||=text(a).split('\n')[0];if(!job.title)continue;
        seen.add(id);result.jobs.push({...job,url:u.href,listingText:text(card)});
      }
      if(result.jobs.length)return {...result,status:'ok'};
      if(/No (?:matching )?(?:jobs|results) found|We couldn.t find any jobs/i.test(body))return {...result,status:'empty'};
      if(/sign in to (?:continue|search)|join .* to view/i.test(body))return {...result,status:'login_required'};
      return result;
    }
    const descriptions=[...document.querySelectorAll('.description__text,#job-details')].filter(visible);
    if(descriptions.length!==1)return result;
    const container=descriptions[0];
    const more=[...document.querySelectorAll('.show-more-less-html__button--more,button[aria-label="Show more description"],button[aria-label="Click to see more description"]')].filter(e=>visible(e)&&e.getAttribute('aria-expanded')!=='true');
    const clipped=[container,...container.querySelectorAll('*')].some(e=>{const s=getComputedStyle(e);return visible(e)&&(/hidden|clip/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+2);});
    if(more.length||clipped)return {...result,status:'jd_truncated'};
    const description=pick(container,['.show-more-less-html__markup'])||text(container);
    if(description.length<40)return result;
    const header=document.querySelector('.top-card-layout,.job-details-jobs-unified-top-card__container--two-pane,.jobs-unified-top-card')||document;
    const job=fields(header);job.title||=pick(document,['h1']);if(!job.title)return result;
    job.salaryRaw=pick(document,['.compensation__salary','.salary-main-rail__data-body','.salary'])||job.salaryRaw;
    // A job insight may also contain employment type. Do not call that a salary.
    if(!/\d/.test(job.salaryRaw))job.salaryRaw='';
    for(const item of document.querySelectorAll('.description__job-criteria-item')){
      const label=pick(item,['.description__job-criteria-subheader']),value=pick(item,['.description__job-criteria-text']);
      if(/Seniority level/i.test(label))job.experience=value;
      if(value)job.tags.push(`${label}: ${value}`);
    }
    const raw=job.salaryRaw;
    const currency=/\b(?:CNY|RMB)\b|人民币/i.test(raw)?'CNY':/\bUSD\b|US\$/i.test(raw)?'USD':/\bEUR\b|€/i.test(raw)?'EUR':null;
    const period=/\/\s*(?:yr|year)|per year|annually/i.test(raw)?'year':/\/\s*(?:mo|month)|per month/i.test(raw)?'month':/\/\s*(?:hr|hour)|per hour/i.test(raw)?'hour':null;
    const dates=[];
    for(const e of document.querySelectorAll('.posted-time-ago__text,.job-details-jobs-unified-top-card__primary-description-container time,.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text')){
      const value=text(e);if(!value||value.length>120||(!/ago|posted|发布|更新/i.test(value)&&e.tagName!=='TIME'))continue;
      dates.push({kind:/reposted|更新/i.test(value)?'updated':'published',raw:value,evidence:{field:'visibleText',quote:value}});
    }
    job.factInputs={salary:{currency,period,evidence:raw?[{field:'visibleText',quote:raw}]:[]},dates};
    const apply=[...header.querySelectorAll('button,a')].find(e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&/^(?:Easy Apply|Apply|申请|申请职位)$/i.test(text(e)));
    if(apply)job.openEvidence={field:'visibleControl',quote:text(apply)};
    return {...result,status:'ok',job:{...job,description}};
  }
  // Security terms are also ordinary job content. Treat a standalone notice as a
  // challenge, not any occurrence of these words inside a title or description.
  const challengeNotice = body.split(/\n+/).some(line =>
    /^(?:请(?:您)?(?:先)?(?:进行|通过|完成)|(?:您|你)(?:的)?|当前)?(?:安全验证|人机验证|访问过于频繁|访问异常)(?:中|失败|未通过)?(?:[：:，,。！!\s]|$)/.test(line.trim()));
  const challenge = /\/security(?:\.html|\/)|\/captcha(?:\/|$)/i.test(path)
    || /请完成.{0,12}验证|拖动.{0,12}滑块/.test(body) || challengeNotice;
  if (challenge) return { ...result, status: 'challenge' };
  // Closure is a standalone page state, and each platform words it differently:
  // BOSS says 已下线/已关闭 while Liepin says 暂停招聘. Matching the phrase
  // anywhere in the body is wrong — a live JD may describe pausing work — so a
  // notice must be its own short line. Unrecognised wording used to fall
  // through to extraction_failed, which left the job queued forever and re-read
  // it on every collection round.
  const CLOSED_PATTERN = /职位已(?:下线|关闭|结束|停止招聘|暂停招聘|暂停)|该职位已不存在|职位不存在|该职位已过期/;
  const closureEvidence = text => {
    for (const raw of String(text ?? '').split(/\n+/)) {
      const line = raw.trim();
      if (!line) continue;
      // A notice may share its line with trailing navigation ("该职位已暂停招聘，
      // 看看其他职位"), so a line that STARTS with the notice always counts. A
      // longer line that merely contains the words does not: that is JD prose
      // such as "当上游异常时暂停招聘批处理".
      if (line.length > 40 && !CLOSED_PATTERN.test(line.slice(0, 12))) continue;
      const match = line.match(CLOSED_PATTERN);
      if (match) return match[0];
    }
    return null;
  };
  const loginGate = /登录(?:后)?(?:查看|解锁)(?:完整|全部)(?:内容|职位|描述)/.test(body);
  if (noticeOnly) {
    if (loginGate) return {status:'login_required'};
    // A global state check cannot tell which posting a closed notice belongs to.
    // Only a bound detail/card (or an imported notice) may close a job record.
    if (kind !== 'state' && closureEvidence(body)) return {status:'closed'};
    return result;
  }
  const panelMode = platform === 'boss' && kind === 'panel';
  const panel = panelMode ? [...document.querySelectorAll('.job-detail-container')].filter(visible) : [];
  const scope = panelMode ? (panel.length === 1 ? panel[0] : null) : document;
  const content = panelMode ? text(scope) : body;
  if (panelMode) {
    if (!scope || [...scope.querySelectorAll('.job-detail-loading')].some(visible)) return result;
    const active = [...document.querySelectorAll('.job-card-wrap.active')].filter(visible);
    const identity = anchor => {
      try {
        const url = new URL(anchor?.getAttribute('href'),location.href);
        return url.origin === location.origin && url.pathname === `/job_detail/${expected?.id}.html`;
      } catch { return false; }
    };
    const links = [...scope.querySelectorAll('.more-job-btn')].filter(visible);
    if (active.length !== 1 || !identity(active[0].querySelector('a.job-name')) || links.length !== 1 || !identity(links[0])) return result;
  }
  const closure = (kind === 'detail' || panelMode) ? closureEvidence(content.slice(0,1800)) : null;
  if (closure) {
    return { ...result, status: 'closed', evidence:{field:'visibleText',quote:closure} };
  }
  const salaryPattern = /(?:\d+(?:\.\d+)?\s*[-–~至]\s*\d+(?:\.\d+)?\s*(?:[kKwW千万]|元)[^\n]{0,15}|薪资面议|面议)/;
  if ((kind === 'detail' || panelMode) && loginGate) {
    return { ...result, status: 'login_required' };
  }
  const companySize = (root,listing=false) => {
    const selector=listing?'span,li':'.company-tag-list li,.company-info-container .company-card li,.company-info-container .company-card span,.company-info .company-scale';
    const values=[...new Set([...root.querySelectorAll(selector)].filter(e=>visible(e)&&!e.children.length
      &&(listing||e.closest('.job-detail-container,.job-detail-box,.job-banner,.company-info-container,.company-info'))
      &&(listing||!e.closest('.love-job-container,.job-card-box,.job-card-wrapper,.job-card-wrap'))).map(text)
      .filter(value=>/^(?:\d[\d,]*\s*[-–~至]\s*\d[\d,]*\s*人|\d[\d,]*\s*人(?:以上|以下|以内)|(?:少于|超过)\d[\d,]*\s*人)$/.test(value)))];
    return values.length===1?{companySizeRaw:values[0],companySizeEvidence:{field:listing?'listingCompanyMetadata':'companyMetadata',quote:values[0]}}:{};
  };
  const fields = (root, titleRoot = root) => {
    const raw = text(root);
    const tags = [...root.querySelectorAll('.tag-list li,.job-label-list li,.job-labels span,.job-labels-box span,.labels span')].map(text).filter(Boolean);
    const lines = raw.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    // Current Liepin cards use hashed CSS classes; visible leaf labels remain stable.
    const leaves = [...root.querySelectorAll('span,li')].filter(e=>!e.children.length).map(text).filter(Boolean);
    const titleSelectors=platform === 'boss'
      ? ['.job-name','h1','.name'] : ['.job-title','[title^="招聘"]','h1','.ellipsis-1'];
    const titleElement=titleSelectors.flatMap(selector=>[...titleRoot.querySelectorAll(selector)]).find(e=>text(e));
    const title=text(titleElement);
    const salaryRaw = pick(root, ['.salary','.job-salary','.job-salary-info']) || leaves.find(s=>salaryPattern.test(s)) || raw.match(salaryPattern)?.[0] || '';
    const salaryElement=[...root.querySelectorAll('.salary,.job-salary,.job-salary-info')].find(el=>text(el)===salaryRaw);
    const salaryFontFamily=salaryElement?getComputedStyle(salaryElement).fontFamily:'';
    const salaryFontLoaded=[...document.fonts].some(font=>font.family.replace(/^['"]|['"]$/g,'')==='kanzhun-mix' && font.status==='loaded');
    const salaryFontUrls=performance.getEntriesByType('resource').map(r=>r.name).filter(url=>/\.(?:woff2?|ttf)(?:\?|$)/i.test(url));
    const salaryFontStylesheets=[...document.styleSheets].filter(sheet=>!sheet.disabled).map(sheet=>sheet.href).filter(Boolean);
    // Hashed Liepin cards put location in a separate bracket-only block.
    // Inline title badges and conflicting blocks are not location evidence.
    const bracketValues=platform==='liepin' && kind==='listing'
      ? [...new Set([...titleRoot.querySelectorAll('div,span')]
        .filter(e=>visible(e)&&e!==titleElement&&!e.contains(titleElement)&&!titleElement?.contains(e))
        .map(e=>text(e).match(/^【\s*([^【】]+?)\s*】$/)?.[1]?.trim()).filter(Boolean))] : [];
    const bracketLocation=bracketValues.length===1?bracketValues[0]:'';
    return {
      title,
      company: pick(root, ['.company-name','.comp-name','.job-card-footer .boss-name','[data-nick="job-detail-company-info"] .ellipsis-1','.company-info a[title]']),
      location: pick(root, ['.job-area','.job-dq','.company-location','.job-address-desc','.job-address','.job-properties .area']) || bracketLocation || '',
      salaryRaw,
      ...(platform==='boss'?{salaryFontFamily,salaryFontLoaded,salaryFontUrls,salaryFontStylesheets}:{}),
      ...companySize(root,kind==='listing'),
      experience: [...tags,...leaves,...lines].find(s=>/^(?:经验不限|在校[\/／]应届|应届(?:毕业)?生|实习生|\d+(?:[-–~至]\d+)?年(?:以上|以下|以内)?(?:经验)?)$/.test(s)) || '',
      education: [...tags,...leaves,...lines].find(s=>/^(?:统招)?(?:本科|硕士|博士|大专|中专|高中|学历不限)(?:及以上)?$/.test(s)) || '',
      tags: [...new Set(tags)],
      advertised: [...lines,...leaves].includes('广告'),
      qualityFlags: /[\uE000-\uF8FF]/.test(salaryRaw) ? ['encoded_salary'] : [],
    };
  };
  if (kind === 'listing') {
    const selector = platform === 'boss' ? 'a[href*="/job_detail/"]' : 'a[href*="/job/"],a[href*="/a/"]';
    const anchors = [...document.querySelectorAll(selector)].filter(visible);
    const seen = new Set();
    for (const a of anchors) {
      if (platform === 'boss' && a.closest('.job-detail-container')) continue;
      let url;
      try { url = new URL(a.getAttribute('href'),location.href); } catch { continue; }
      if(url.protocol!=='https:'||url.username||url.password||url.port||!(platform==='boss'?['www.zhipin.com','zhipin.com']:['www.liepin.com','liepin.com']).includes(url.hostname))continue;
      const valid = platform === 'boss' ? /^\/job_detail\/[\w-]+\.html$/.test(url.pathname) : /^\/(job|a)\/\d+\.shtml$/.test(url.pathname);
      if (!valid || seen.has(url.pathname)) continue;
      let card = a.closest('.job-card-wrapper,.job-card-box,.job-list-item');
      if (!card) {
        card = a;
        for (let depth=0; depth<6 && card.parentElement && card.parentElement !== document.body; depth++) {
          const parent = card.parentElement;
          const links = new Set([...parent.querySelectorAll(selector)].map(e=>e.getAttribute('href')?.split('?')[0]));
          if (links.size > 1) break;
          card = parent;
        }
      }
      const job = fields(card,a);
      job.title ||= text(a).split('\n')[0];
      if (!job.title) continue;
      seen.add(url.pathname);
      result.jobs.push({ ...job, url: url.href, listingText: text(card) });
    }
    if (result.jobs.length) return { ...result, status: 'ok' };
  } else {
    const selectors = platform === 'boss'
      ? [ ...(panelMode ? ['.job-detail-body .desc'] : []),'.job-sec-text','.job-detail-body .text','.job-detail-box .job-detail-section .text']
      : ['.job-intro-container [data-selector="job-intro-content"]','.job-description .content','.job-intro-content','.job-description','.job-intro .content'];
    const description = pick(scope || document,selectors);
    // A thin description is the source being brief, not the extractor failing —
    // but only when a single real JD container is present. Nav/footer text and
    // platform home pages must never be archived as a posting, so an empty or
    // ambiguous container stays extraction_failed.
    const thinContainer = platform === 'liepin'
      ? [...document.querySelectorAll('.job-intro-container [data-selector="job-intro-content"]')].filter(visible).length === 1
      : platform === 'boss' && !panelMode
        && [...document.querySelectorAll('.job-sec-text')].filter(visible).length === 1;
    const shortDescription = thinContainer && description.length>0 && description.length<40
      && !/加载|正在获取|loading|请稍候/i.test(description);
    if ((description.length >= 40 || shortDescription) && !/登录后.{0,8}(?:查看|解锁)/.test(description)) {
      const liepinHeaders=platform==='liepin'?[...document.querySelectorAll('.job-apply-container')].filter(visible):[];
      if(liepinHeaders.length>1)return result;
      const modernLiepin=liepinHeaders[0];
      if(shortDescription&&platform==='liepin'&&!modernLiepin)return result;
      const root = modernLiepin || (panelMode ? scope : document.querySelector('.job-detail-container,.job-detail-box,.job-banner') || document.body);
      const job = fields(root);
      if(platform==='boss'&&!panelMode){
        const companies=[...document.querySelectorAll('.sider-company .company-info')].filter(visible);
        if(companies.length===1)job.company=text(companies[0]);
        const workplaces=[...document.querySelectorAll('.job-location')].filter(e=>visible(e)&&!e.closest('.recommend,.recommend-job,.job-list'));
        if(workplaces.length===1)job.location=text(workplaces[0]).split('\n')[0].trim();
        job.location ||= pick(root,['.text-city']);
        job.experience ||= pick(root,['.text-experiece','.text-experience']);
        job.education ||= pick(root,['.text-degree']);
      }
      if(modernLiepin){
        job.location=pick(root,['.job-properties > span:first-child']);
        const employers=[...document.querySelectorAll('.company-info-container .company-card .content .name')].filter(visible);
        job.company=employers.length===1?text(employers[0]):'';
        const companies=[...document.querySelectorAll('.company-info-container')].filter(visible);
        if(companies.length===1)Object.assign(job,companySize(companies[0]));
      }
      if (panelMode && (!job.title || job.title !== expected?.title)) return result;
      job.title ||= pick(document,['h1']);
      if(!job.title)return result;
      if(shortDescription)return {...result,status:'source_insufficient',reason:'short_description',job:{...job,description}};
      job.salaryRaw ||= pick(panelMode ? scope : document,['.salary','.job-salary','.job-salary-info']);
      if (/[\uE000-\uF8FF]/.test(job.salaryRaw) && !job.qualityFlags.includes('encoded_salary')) job.qualityFlags.push('encoded_salary');
      const salaryLabel=pick(root,['.salary-label','.job-salary-label']);
      const salaryContext=`${salaryLabel}${job.salaryRaw}`;
      const currency=/人民币|RMB|CNY/.test(salaryContext)?'CNY':/美元|USD/.test(salaryContext)?'USD':/欧元|EUR/.test(salaryContext)?'EUR':null;
      const period=/月薪|每月|\/月/.test(salaryContext)?'month':/年薪|每年|\/年/.test(salaryContext)?'year':/日薪|每天|\/(?:天|日)/.test(salaryContext)?'day':null;
      const dates=[];
      for(const element of root.querySelectorAll('.job-publish-time,.job-refresh-time,.job-time,.publish-time,.update-time,.recruiter-active,.boss-online-tag,[data-job-date]')){
        const raw=text(element);if(!raw||raw.length>120)continue;
        const kind=/发布|刊登/.test(raw)?'published':/更新|刷新/.test(raw)?'updated':/有效期|截止/.test(raw)?'valid_through':/活跃|在线/.test(raw)?'recruiter_active':'unknown';
        dates.push({kind,raw,evidence:{field:'visibleText',quote:raw}});
      }
      job.factInputs={salary:{currency,period,evidence:salaryContext?[{field:'visibleText',quote:salaryContext}]:[]},dates};
      // The page's public JobPosting block carries explicit units and dates.
      // Require a unique current-job URL/title match; recommendation metadata
      // and ambiguous/stale records must not enrich the visible JD.
      const sameJobUrl=value=>{
        try{
          const target=new URL(panelMode?expected?.url:location.href),u=new URL(value);
          return u.protocol==='https:'&&!u.username&&!u.password&&!u.port
            &&u.hostname.replace(/^www\./,'')===target.hostname.replace(/^www\./,'')
            &&u.pathname===target.pathname;
        }catch{return false;}
      };
      const records=[];
      for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,16)){
        if(script.textContent.length>256*1024)continue;
        try{
          const parsed=JSON.parse(script.textContent),items=Array.isArray(parsed)?parsed:[parsed];
          for(const item of items.slice(0,64))if(item&&typeof item==='object')records.push(item,...(Array.isArray(item['@graph'])?item['@graph'].slice(0,64):[]));
        }catch{/* Malformed optional metadata never replaces the visible JD. */}
      }
      const matching=records.filter(r=>r&&[].concat(r['@type']||[]).includes('JobPosting')&&sameJobUrl(r.url)
        &&typeof r.title==='string'&&r.title.trim()===job.title.trim());
      if(matching.length===1){
        const metadata=matching[0],base=metadata.baseSalary,value=base?.value;
        const unit={MONTH:'month',YEAR:'year',DAY:'day'}[value?.unitText];
        if(/^[A-Z]{3}$/.test(base?.currency||'')&&unit&&typeof value.minValue==='number'&&typeof value.maxValue==='number'
          &&Number.isFinite(value.minValue)&&Number.isFinite(value.maxValue)&&value.minValue>=0&&value.maxValue>=value.minValue){
          const salary=job.factInputs.salary;
          salary.currency=currency&&currency!==base.currency?null:base.currency;
          salary.period=period&&period!==unit?null:unit;
          salary.structuredRange={min:value.minValue,max:value.maxValue};
          salary.evidence.push({field:'JobPosting.baseSalary',quote:JSON.stringify({url:metadata.url,currency:base.currency,minValue:value.minValue,maxValue:value.maxValue,unitText:value.unitText})});
        }
        for(const [field,kind] of [['datePosted','published'],['validThrough','valid_through']]){
          const raw=metadata[field];if(typeof raw==='string'&&raw.length<=120)dates.push({kind,raw,evidence:{field:`JobPosting.${field}`,quote:JSON.stringify({url:metadata.url,[field]:raw})}});
        }
        const refreshed=records.filter(r=>r&&r['@context']==='https://ziyuan.baidu.com/contexts/cambrian.jsonld'&&sameJobUrl(r['@id'])&&typeof r.upDate==='string'&&r.upDate.length<=120);
        if(refreshed.length===1)dates.push({kind:'updated',raw:refreshed[0].upDate,evidence:{field:'pageMetadata.upDate',quote:JSON.stringify({'@id':refreshed[0]['@id'],upDate:refreshed[0].upDate})}});
      }
      const control=[...root.querySelectorAll('button,a,[role="button"]')].find(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'
        &&(platform==='boss'?/^(?:立即沟通|继续沟通)$/:/^(?:立即沟通|立即投递|投递简历|申请职位|应聘职位|投简历|聊一聊)$/).test(text(el)));
      if(control)job.openEvidence={field:'visibleControl',quote:text(control)};
      return { ...result, status: 'ok', job: { ...job, description } };
    }
  }
  const login = /登录后.{0,12}(?:查看|继续|解锁)|扫码登录|短信登录|微信扫码登录/.test(body)
    || /\/passport\/.+(?:login|index)|\/login(?:\/|\.|$)/.test(path);
  if (login) return { ...result, status: 'login_required' };
  if (kind === 'listing' && /暂无(?:符合条件的)?(?:相关)?职位|没有找到.{0,12}职位|未找到.{0,12}职位/.test(body)) return { ...result, status: 'empty' };
  return result;
}
