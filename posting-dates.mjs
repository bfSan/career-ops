const KINDS=new Set(['published','updated','valid_through','recruiter_active','unknown']);
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function dayAt(at,timezone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// Liepin renders a single visible update label for every posting older than
// about 90 days. In the captured pool that label reads "90天前更新" for postings
// whose page-metadata upDate spans 0 to 1735 days, and the newest absolute
// "M月D日更新" label tops out at 91 days — so the number is a display threshold,
// not a measurement. Converting it to a day would claim that 113 postings were
// all refreshed inside the same six days. A capped label keeps its raw text and
// stays unknown; the same page exposes pageMetadata.upDate for a real date.
const CAPPED_RELATIVE_DAYS = 90;
const cappedRelative = raw => {
  const match = /(\d+)\s*天前/.exec(raw);
  return match ? Number(match[1]) >= CAPPED_RELATIVE_DAYS : false;
};
export function parsePostingDate({kind='unknown',raw='',observedAt,timezone=null,evidence=null}={},{allowCappedRelative=false}={}) {
  const fact={kind:KINDS.has(kind)?kind:'unknown',raw,value:null,precision:'unknown',timezone,observedAt,evidence};
  if(fact.kind==='unknown'||typeof raw!=='string'||!raw.trim()||!Number.isFinite(Date.parse(observedAt))
    ||typeof evidence?.field!=='string'||!evidence.field||typeof evidence.quote!=='string'||!evidence.quote.includes(raw))return fact;
  const instant=raw.match(/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)/)?.[0];
  if(instant){
    if(!validDay(instant.slice(0,10))||!Number.isFinite(Date.parse(instant))||Number(instant.slice(11,13))>23)return fact;
    return {...fact,value:new Date(instant).toISOString(),precision:'instant'};
  }
  if(!timezone)return fact;
  let today;try{today=dayAt(observedAt,timezone);}catch{return fact;}
  let value;
  const explicit=raw.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if(explicit)value=`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`;
  else {
    const ago=raw.match(/(\d+)\s*(?:天前|days? ago)/i);
    // A capped label is a threshold, so it can never become a day. Legacy
    // snapshots recorded before this rule stay readable through the option.
    const capped=(!allowCappedRelative)&&cappedRelative(raw);
    const days=capped?null:/今天|今日|\btoday\b/i.test(raw)?0:/昨天|昨日|\byesterday\b/i.test(raw)?1:ago?Number(ago[1]):null;
    if(days!==null&&days<=36500)value=new Date(Date.parse(today)-days*86400000).toISOString().slice(0,10);
  }
  return validDay(value)?{...fact,value,precision:'day'}:fact;
}
export function isValidDateFact(fact) {
  if(!fact||typeof fact!=='object')return false;
  const parsed=parsePostingDate(fact);
  return KINDS.has(fact.kind)&&parsed.value===fact.value&&parsed.precision===fact.precision
    &&typeof fact.raw==='string'&&fact.raw.length<=4096&&Number.isFinite(Date.parse(fact.observedAt));
}
function dayStart(value,timezone) {
  const target=Date.parse(`${value}T00:00:00Z`);let guess=target;
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(p=>[p.type,p.value]));
    const wall=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    guess+=target-wall;
  }
  return guess;
}
export function postingDayBounds(fact) {
  if(fact?.kind!=='published'||fact.precision!=='day'||!isValidDateFact(fact))return null;
  const next=new Date(Date.parse(fact.value)+86400000).toISOString().slice(0,10);
  try{return {start:dayStart(fact.value,fact.timezone),end:dayStart(next,fact.timezone)-1};}catch{return null;}
}
export function publishedDateFact(job) {
  return Array.isArray(job?.dates)?job.dates.find(f=>f.kind==='published'&&f.value&&isValidDateFact(f)):undefined;
}
export function toPostedAt(fact) {
  if(fact?.kind!=='published'||!isValidDateFact(fact))return undefined;
  return fact.precision==='instant'?Date.parse(fact.value):postingDayBounds(fact)?.start;
}
export function displayPostingDate(job) {
  const fact=publishedDateFact(job);
  if(fact?.precision==='day')return fact.value;
  const value=job?.postedAt;
  return typeof value==='number'&&Number.isFinite(value)&&value>0?new Date(value).toISOString().slice(0,10):'';
}
