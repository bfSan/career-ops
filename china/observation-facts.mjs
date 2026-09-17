import {isDeepStrictEqual} from 'node:util';
import {parseCompensation} from '../compensation.mjs';
import {parsePostingDate} from '../posting-dates.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function evidence(e) {
  return object(e)&&typeof e.field==='string'&&e.field.length>0&&e.field.length<=128
    &&typeof e.quote==='string'&&e.quote.length>0&&e.quote.length<=4096;
}
export function validateObservationFacts(facts) {
  if(!object(facts)||Object.keys(facts).sort().join(',')!=='compensation,dates,schemaVersion'||facts.schemaVersion!==1
    ||JSON.stringify(facts).length>65536)throw new Error('invalid observation facts');
  const c=facts.compensation;
  if(c!==null){
    if(!object(c)||typeof c.raw!=='string'||c.raw.length>4096||!Array.isArray(c.evidence)||c.evidence.length>32||!c.evidence.every(evidence)
      ||(!isDeepStrictEqual(c,parseCompensation(c))&&!isDeepStrictEqual(c,parseCompensation(c,{maxPayments:24}))))throw new Error('invalid compensation facts');
  }
  if(facts.dates!==null){
    if(!Array.isArray(facts.dates)||facts.dates.length>32)throw new Error('invalid date facts');
    for(const f of facts.dates){
      // A capped "90天前更新" label no longer produces a day. Snapshots written
      // before that rule kept a real date, so they stay readable here instead of
      // turning every frozen study that contains one into an invalid input.
      const legacyCapped=isDeepStrictEqual(f,parsePostingDate(f,{allowCappedRelative:true}));
      if(!object(f)||typeof f.raw!=='string'||f.raw.length>4096||!evidence(f.evidence)||!Number.isFinite(Date.parse(f.observedAt))
        ||(!isDeepStrictEqual(f,parsePostingDate(f))&&!legacyCapped))throw new Error('invalid date fact');
    }
  }
  return facts;
}
export function selectObservationFacts(job,{contentHash,observedAt}) {
  const cutoff=Date.parse(observedAt);if(!Number.isFinite(cutoff))throw new Error('invalid facts cutoff');
  const matches=(job?.observations||[]).filter(o=>o.status==='ok'&&o.hash===contentHash&&o.facts&&Date.parse(o.at)<=cutoff)
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  if(!matches.length)return null;
  return structuredClone(validateObservationFacts(matches[0].facts));
}

export function dateFactStatus(facts,kind) {
  if(!facts||facts.dates===null)return {status:'not_collected',facts:[]};
  const matching=facts.dates.filter(f=>f.kind===kind);
  return {status:matching.some(f=>f.value)?'known':matching.length||facts.dates.some(f=>f.kind==='unknown')?'unresolved':'not_provided',facts:structuredClone(matching)};
}
