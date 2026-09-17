import {createHash} from 'node:crypto';

// Verified against the official kanzhun-Regular ASCII digits: all ten glyph
// outlines match in these three kanzhun-mix formats. See CHINA_ADAPTER_AUDIT.md.
const FONT_HASHES=new Map([
  ['https://img.bosszhipin.com/static/file/2023/30k9dfumyv1693967587404.ttf','88f4b9338bc6939285b2f95f1a217b6cb7862f898a75dd70a285f1fa24386d6d'],
  ['https://img.bosszhipin.com/static/file/2023/3kovsijnt11693967587313.woff2','37be9f6d4984819476d27d4862faa8d23181acc32bed2edafd4f42e5184cd924'],
  ['https://img.bosszhipin.com/static/file/2023/w57q70gcfp1693967587502.woff','f6033c0264a13beebea67ab1f75d46de8eb7ad9059165638dfe94703d3b5d1e1'],
]);
const privateGlyphs=/[\uE000-\uF8FF]/;
export async function loadNativeSalaryFont(job,{fetchImpl=globalThis.fetch,wait=async()=>{},onEvent=()=>{},timeoutMs=5000}={}) {
  const family=String(job?.salaryFontFamily||'').split(',')[0].trim().replace(/^['"]|['"]$/g,'');
  if(!privateGlyphs.test(job?.salaryRaw||'')||family!=='kanzhun-mix'||!job.salaryFontLoaded)return [];
  const download=async(url,limit,kind)=>{
  let timer,reader;
  try {
    await wait();
    onEvent({kind,url,at:new Date().toISOString()});
    const controller=new AbortController();timer=setTimeout(()=>controller.abort(),Math.min(Math.max(timeoutMs,1),10000));
    const response=await fetchImpl(url,{credentials:'omit',redirect:'error',signal:controller.signal});
    if(!response.ok||response.redirected||(response.url&&response.url!==url)||Number(response.headers.get('content-length'))>limit)return null;
    reader=response.body?.getReader();if(!reader)return null;
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)return null;chunks.push(Buffer.from(value));}
    return Buffer.concat(chunks);
  }catch{return null;}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
  };
  let url=job.salaryFontUrls?.find(value=>FONT_HASHES.has(value)),stylesheet;
  if(!url){
    // Cached fonts can disappear from Resource Timing. Follow only stylesheets
    // observed on this document; never guess a deployed stylesheet version.
    const candidates=[...new Set(job.salaryFontStylesheets||[])].filter(value=>{
      try{const u=new URL(value);return u.origin==='https://static.zhipin.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/zhipin-geek-spa\/web\/v\d+\/static\/css\/app~[\w.-]+\.css$/.test(u.pathname);}catch{return false;}
    }).sort((a,b)=>Number(b.includes('/app~0.'))-Number(a.includes('/app~0.'))).slice(0,3);
    for(const cssUrl of candidates){
      const bytes=await download(cssUrl,1024*1024,'public_salary_stylesheet');if(!bytes)continue;
      const css=bytes.toString('utf8').replace(/\/\*[\s\S]*?\*\//g,'');
      for(const face of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)){
        if(!/(?:^|;)\s*font-family\s*:\s*['"]?kanzhun-mix['"]?\s*(?:;|$)/i.test(face[1]))continue;
        for(const resource of face[1].matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)){
          let resolved;try{resolved=new URL(resource[1],cssUrl).href;}catch{continue;}
          if(FONT_HASHES.has(resolved)){url=resolved;break;}
        }
        if(url)break;
      }
      if(url){stylesheet={url:cssUrl,sha256:createHash('sha256').update(bytes).digest('hex')};break;}
    }
  }
  if(!url)return [];
  const bytes=await download(url,32768,'public_salary_font');if(!bytes)return [];
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return sha256===FONT_HASHES.get(url)?[{url,sha256,...(stylesheet?{stylesheet}:{})}]:[];
}
export function normalizeSalary(job,fonts=[]) {
  const {salaryText:_text,salaryEvidence:_evidence,...result}=job;
  const raw=String(job.salaryRaw || '');
  if(!raw) return result;
  if(!privateGlyphs.test(raw)) return {...result,salaryText:raw};
  const family=String(job.salaryFontFamily || '').split(',')[0].trim().replace(/^['"]|['"]$/g,'');
  if(family!=='kanzhun-mix' || !job.salaryFontLoaded) return result;
  const evidence=[...fonts,...(job.salaryEvidence?.method==='verified_font'?[job.salaryEvidence]:[])].find(font=>FONT_HASHES.get(font.url)===font.sha256 && typeof font.sha256==='string'
    && (!font.stylesheet||job.salaryFontStylesheets?.includes(font.stylesheet.url)));
  if(!evidence) return result;
  const text=raw.replace(/[\uE031-\uE03A]/g,char=>String(char.codePointAt(0)-0xe031));
  if(privateGlyphs.test(text)) return result;
  return {...result,salaryText:text,salaryEvidence:{method:'verified_font',mapId:'kanzhun-mix-2023',url:evidence.url,sha256:evidence.sha256,...(evidence.stylesheet?{stylesheet:evidence.stylesheet}:{})}};
}

// Observe only font resources the page already requested. No extra downloads,
// account API calls, cookie reads or page changes are performed here.
export function observeSalaryFonts(page) {
  const fonts=new Map(),requestEpoch=new WeakMap();let pending=0,documentEpoch=0;
  const reset=()=>{documentEpoch++;pending=0;fonts.clear();};
  const requested=request=>{
    if(request.isNavigationRequest() && request.frame()===page.mainFrame()) reset();
    requestEpoch.set(request,documentEpoch);
  };
  const receive=async response=>{
    const url=response.url();
    if(response.request().resourceType()!=='font' || !FONT_HASHES.has(url)) return;
    const epoch=requestEpoch.get(response.request());
    if(epoch!==documentEpoch) return;
    fonts.delete(url);
    pending++;
    try {
      const data=await response.body();
      if(epoch!==documentEpoch || data.length>32*1024) return;
      const sha256=createHash('sha256').update(data).digest('hex');
      if(FONT_HASHES.get(url)===sha256) fonts.set(url,{url,sha256});
    }catch { /* Unavailable/changed fonts leave the raw salary unresolved. */ }
    finally {if(epoch===documentEpoch) pending--;}
  };
  page.on('response',receive);
  page.on('request',requested);
  page.once('close',()=>{reset();page.off('response',receive);page.off('request',requested);});
  return {
    pending:()=>pending>0,
    decorate(result) {
      const evidence=[...fonts.values()];
      if(result.job) result={...result,job:normalizeSalary(result.job,evidence)};
      if(result.jobs) result={...result,jobs:result.jobs.map(job=>normalizeSalary(job,evidence))};
      return result;
    },
  };
}
