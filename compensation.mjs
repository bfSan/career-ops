// Shared compensation facts. Currency/period are evidence-backed inputs, never locale defaults.
const bound = n => typeof n==='number' && Number.isFinite(n) && n>=0;
// Rates the shared model cannot express (per hour, per week, per visit, per
// person-day). Without this guard "80-250元/时" parsed as a monthly 80-250 CNY
// salary whenever the caller supplied period=month, because "时" matched no
// known period marker and therefore looked like a harmless absence.
const UNSUPPORTED_PAY_RATE=/(?:\d|\uE000-\uF8FF)[^\d\n]{0,6}\/\s*(?:时|小时|周|星期|次|人天|人日)|时薪|每小时|周薪|日结|按次|按人天|按人日|[\d\uE000-\uF8FF][^\d\n]{0,6}\/\s*(?:hour|week\b|visit\b)/i;
export const hasUnsupportedPayRate=raw=>UNSUPPORTED_PAY_RATE.test(String(raw??''));
const scale = unit => /万/.test(unit||'')?10000:/k/i.test(unit||'')?1000:1;
export function validateNormalizedCompensation(summary) {
  const n=summary?.advertised_comp_normalized;
  if(!n||typeof n!=='object'||Array.isArray(n)||n.raw!==summary.advertised_comp||n.period!=='year'
    ||!['monthly_x12','explicit_annual'].includes(n.basis)||!Array.isArray(n.evidence)||!n.evidence.length)return null;
  const parsed=parseCompensation({raw:n.raw,currency:n.currency,period:n.basis==='monthly_x12'?'month':'year',evidence:n.evidence});
  const annual=toAnnualSalary(parsed);
  if(!annual||(n.min??null)!==(annual.min??null)||(n.max??null)!==(annual.max??null))return null;
  return {raw:n.raw,currency:n.currency,period:'year',min:annual.min??null,max:annual.max??null,basis:n.basis,evidence:structuredClone(n.evidence)};
}
const range = (min,max,currency,factor=1) => ({min:min===null?null:min*factor,max:max===null?null:max*factor,currency});
export function parseCompensation({raw='',currency=null,period=null,evidence=[]}={}, {maxPayments=Infinity,allowUnsupportedPayRate=false}={}) {
  const c={raw,currency,period,min:null,max:null,paymentsPerYear:null,annualizedMonthly:null,advertisedAnnualCash:null,
    guaranteedPayments:null,status:'unknown',componentsUnknown:typeof raw==='string'&&/综合|浮动|绩效|奖金|提成|股票|期权/.test(raw),evidence};
  if(typeof raw!=='string'||!raw.trim()||/[\uE000-\uF8FF]/.test(raw)||/面议/.test(raw))return c;
  if(!allowUnsupportedPayRate&&hasUnsupportedPayRate(raw))return c;
  if(!/^[A-Z]{3}$/.test(currency||'')||!['month','year','day'].includes(period)
    ||!Array.isArray(evidence)||!evidence.length||evidence.some(e=>!e||typeof e.field!=='string'||!e.field||typeof e.quote!=='string'||!e.quote))return c;
  const evidenceText=[raw,...evidence.map(e=>e.quote)].join('\n');
  const periods=[['month',/月薪|每月|\/\s*(?:月|mo(?:nth)?\b)/i],['year',/年薪|每年|\/\s*(?:年|yr\b|year\b)/i],['day',/日薪|每天|\/\s*(?:天|日|day\b)/i]].filter(([,r])=>r.test(evidenceText)).map(([p])=>p);
  if(periods.some(p=>p!==period))return c;
  const currencies=[['CNY',/人民币|RMB|CNY/],['USD',/美元|USD|US\$/],['EUR',/欧元|EUR|€/]].filter(([,r])=>r.test(evidenceText)).map(([v])=>v);
  if(currencies.some(v=>v!==currency))return c;
  const payments=raw.match(/(?:[·.x×*]\s*)?(\d+)\s*薪/);
  if(payments){const n=Number(payments[1]);if(period!=='month'||n<12||n>maxPayments||!Number.isSafeInteger(n))return c;c.paymentsPerYear=n;}
  const value=raw.replace(/(?:[·.x×*]\s*)?\d+\s*薪/,'');
  const m=value.match(/(\d+(?:\.\d+)?)\s*(万|[kK]|元)?\s*(?:[-–—~至]\s*(\d+(?:\.\d+)?)\s*(万|[kK]|元)?)?/);
  if(!m||/\d/.test(value.slice(0,m.index)+value.slice(m.index+m[0].length)))return c;
  const first=Number(m[1])*scale(m[2]||m[4]);
  let min=first,max=m[3]?Number(m[3])*scale(m[4]||m[2]):first;
  if(!m[3]){
    if(/以下|以内|至多|不超过|<=|≤/.test(value))min=null;
    else if(/以上|起|至少|不低于|>=|≥/.test(value))max=null;
  }
  if((min!==null&&!bound(min))||(max!==null&&!bound(max))||(min!==null&&max!==null&&min>max))return c;
  const factor=period==='month'?Math.max(12,c.paymentsPerYear||12):1;
  if([min,max].some(n=>n!==null&&!bound(n*factor)))return c;
  Object.assign(c,{min,max,status:'parsed'});
  if(period==='month'){
    c.annualizedMonthly=range(min,max,currency,12);
    if(c.paymentsPerYear)c.advertisedAnnualCash=range(min,max,currency,c.paymentsPerYear);
  }else if(period==='year')c.advertisedAnnualCash=range(min,max,currency);
  return c;
}
export function toAnnualSalary(c) {
  // Frozen observations written before the per-hour guard can still claim
  // period=month. Re-check the raw text so downstream reports never annualize
  // an hourly, weekly, per-visit or per-person-day rate.
  if(hasUnsupportedPayRate(c?.raw))return undefined;
  if(c?.status!=='parsed'||!['month','year'].includes(c.period)||!/^[A-Z]{3}$/.test(c.currency||''))return undefined;
  const salary={};const multiplier=c.period==='month'?12:1;
  if([c.min,c.max].some(n=>n!==null&&n!==undefined&&!bound(n*multiplier)))return undefined;
  if(bound(c.min))salary.min=c.min*multiplier;
  if(bound(c.max))salary.max=c.max*multiplier;
  if(!Object.keys(salary).length)return undefined;
  return {...salary,currency:c.currency};
}
