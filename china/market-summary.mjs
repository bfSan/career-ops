import { DIMENSIONS, validateBundle } from './market-analysis.mjs';
import { fingerprint } from './store.mjs';
import {toAnnualSalary} from '../compensation.mjs';
import {dateFactStatus} from './observation-facts.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const order = keys => (a, b) => {
  for (const key of keys) { const result = compare(a[key], b[key]); if (result) return result; }
  return 0;
};
const normalize = subject => subject.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const groupKey = (record, dimension) => JSON.stringify([record.cityGroup, record.roleFamily, dimension]);
const context = (node, parent) => ({
  necessity: parent.necessity === 'preferred' || node.necessity === 'preferred' ? 'preferred' :
    node.necessity === 'unspecified' ? (parent.necessity || 'unspecified') : node.necessity,
  alternative: parent.alternative || node.logic === 'any',
  inferred: parent.inferred || node.evidenceTier === 'inferred',
});
const rootContext = { necessity: null, alternative: false, inferred: false };

export function collectLeaves(requirements) {
  const leaves = [];
  const visit = (node, parent) => {
    const next = context(node, parent);
    if (next.inferred) return;
    if (node.logic === 'single') leaves.push({ requirement: node, alternative: next.alternative, necessity: next.necessity });
    else for (const child of node.alternatives) visit(child, next);
  };
  for (const node of requirements) visit(node, rootContext);
  return leaves;
}

export function summarize(study, bundle) {
  const validation = validateBundle(study, bundle);
  if (!validation.valid) {
    const error = new Error('invalid_analysis'); error.code = 'invalid_analysis'; error.validation = validation; throw error;
  }
  const groups = new Map(), frequencies = new Map(), companies = new Map(), details = [], conflicts = [];
  let anonymousOrUnknownJobs = 0;
  const records = [...bundle.records].sort(order(['jobKey']));
  for (const record of records) {
    const leaves = collectLeaves(record.requirements);
    for (const dimension of DIMENSIONS) {
      const key = groupKey(record, dimension);
      if (!groups.has(key)) groups.set(key, { cityGroup: record.cityGroup, roleFamily: record.roleFamily, dimension, jobs: 0, reviewedJobKeys: [], notReviewedJobKeys: [], reviewedWithoutMentionJobKeys: [] });
      const group = groups.get(key); group.jobs++;
      group[record.coverage[dimension] === 'reviewed' ? 'reviewedJobKeys' : 'notReviewedJobKeys'].push(record.jobKey);
      if (record.coverage[dimension] === 'reviewed' && !leaves.some(x => x.requirement.dimension === dimension)) group.reviewedWithoutMentionJobKeys.push(record.jobKey);
    }
    for (const { requirement, alternative, necessity } of leaves) {
      if (record.coverage[requirement.dimension] !== 'reviewed') continue;
      const subject = normalize(requirement.subject), kind = `${alternative ? 'alternative_' : ''}${necessity}`;
      const key = JSON.stringify([record.cityGroup, record.roleFamily, requirement.dimension, subject, kind]);
      if (!frequencies.has(key)) frequencies.set(key, { cityGroup: record.cityGroup, roleFamily: record.roleFamily, dimension: requirement.dimension, subject, kind, keys: new Set() });
      frequencies.get(key).keys.add(record.jobKey);
    }
    const visit = (node, parent, path) => {
      const next = context(node, parent), logicPath = `${path}/${encodeURIComponent(node.id)}:${node.logic}`;
      const { alternatives, ...raw } = structuredClone(node);
      details.push({ ...raw, alternatives, studyId: study.manifest.studyId, jobKey: record.jobKey, contentHash: record.contentHash,
        cityGroup: record.cityGroup, roleFamily: record.roleFamily, requirementId: node.id, logicPath,
        rawNecessity: node.necessity, effectiveNecessity: next.necessity, alternative: next.alternative, inferred: next.inferred,
        coverage: record.coverage[node.dimension], sourceField: node.evidence.field, quote: node.evidence.quote });
      for (const child of alternatives) visit(child, next, logicPath);
    };
    for (const node of record.requirements) visit(node, rootContext, '');
    if (record.companyKey === null) anonymousOrUnknownJobs++;
    else {
      if (!companies.has(record.companyKey)) companies.set(record.companyKey, []);
      companies.get(record.companyKey).push(record.jobKey);
    }
    for (const conflict of record.conflicts) conflicts.push({ jobKey: record.jobKey, contentHash: record.contentHash, ...structuredClone(conflict) });
  }
  const rows = [...frequencies.values()].map(({ keys, ...row }) => ({ ...row, count: keys.size,
    denominator: groups.get(groupKey(row, row.dimension)).reviewedJobKeys.length, jobKeys: [...keys].sort(compare) }))
    .sort(order(['cityGroup', 'roleFamily', 'dimension', 'subject', 'kind']));
  const salaryJobs = [...study.sources].sort(order(['jobKey'])).map(source => {
    const salaryRaw = source.fields.salaryRaw || null;
    const encoded = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u.test(salaryRaw || '') || (source.fields.qualityFlags || []).includes('encoded_salary');
    const salaryText = source.fields.salaryText || (!encoded ? salaryRaw : null);
    return { jobKey: source.jobKey, salaryRaw, salaryText, encoded, status: salaryText ? 'readable' : salaryRaw ? 'encoded' : 'not_provided' };
  });
  const summary = {
    schemaVersion: 1, studyId: study.manifest.studyId, sourceDigest: study.manifest.sourceDigest,
    analysisDigest: fingerprint(bundle), complete: validation.complete, jobs: study.sources.length,
    companyCoverage: { identifiedJobs: records.length - anonymousOrUnknownJobs, distinctCompanies: companies.size, anonymousOrUnknownJobs,
      companies: [...companies].map(([companyKey, jobKeys]) => ({ companyKey, count: jobKeys.length, jobKeys })).sort(order(['companyKey'])) },
    missingness: {
      groups: [...groups.values()].map(group => ({ ...group, reviewed: group.reviewedJobKeys.length, notReviewed: group.notReviewedJobKeys.length,
        reviewedWithoutMention: group.reviewedWithoutMentionJobKeys.length })).sort(order(['cityGroup', 'roleFamily', 'dimension'])),
      salary: { readable: salaryJobs.filter(j => j.salaryText !== null).length, encoded: salaryJobs.filter(j => j.status === 'encoded').length,
        notProvided: salaryJobs.filter(j => j.status === 'not_provided').length, jobs: salaryJobs },
      postingDate: { status: 'not_collected', jobs: study.sources.length },
      conflicts: { jobs: new Set(conflicts.map(c => c.jobKey)).size, count: conflicts.length },
    }, rows, details: details.sort(order(['cityGroup', 'roleFamily', 'dimension', 'subject', 'jobKey', 'logicPath'])),
    conflicts: conflicts.sort(order(['jobKey', 'field', 'note'])),
  };
  if(study.manifest.schemaVersion===2){
    summary.schemaVersion=2;
    const dateJobs=study.sources.map(s=>({jobKey:s.jobKey,...dateFactStatus(s.facts,'published')}));
    summary.missingness.postingDate={known:dateJobs.filter(j=>j.status==='known').length,notCollected:dateJobs.filter(j=>j.status==='not_collected').length,
      notProvided:dateJobs.filter(j=>j.status==='not_provided').length,unresolved:dateJobs.filter(j=>j.status==='unresolved').length,jobs:dateJobs};
    const byBasis=new Map();let notCollected=0,notProvided=0,unresolved=0,nonAnnual=0;
    for(const source of study.sources){
      const c=source.facts?.compensation,salary=toAnnualSalary(c);
      if(!source.facts){notCollected++;continue;}if(!c){notProvided++;continue;}if(!salary){if(c.status==='parsed'&&c.period==='day')nonAnnual++;else unresolved++;continue;}
      const basis=c.period==='month'?'monthly_x12':'explicit_annual',key=`${salary.currency}:${basis}`;
      if(!byBasis.has(key))byBasis.set(key,{currency:salary.currency,basis,period:'year',jobKeys:[],ranges:[]});
      const group=byBasis.get(key);group.jobKeys.push(source.jobKey);group.ranges.push(salary);
    }
    summary.compensationGroups=[...byBasis.values()].map(({ranges,...g})=>{
      const mids=ranges.filter(r=>r.min!==undefined&&r.max!==undefined).map(r=>(r.min+r.max)/2).sort((a,b)=>a-b),mid=Math.floor(mids.length/2);
      return {...g,jobs:g.jobKeys.length,withBothBounds:mids.length,medianRangeMidpoint:mids.length?(mids.length%2?mids[mid]:(mids[mid-1]+mids[mid])/2):null};
    }).sort(order(['currency','basis']));
    summary.missingness.compensation={known:summary.compensationGroups.reduce((n,g)=>n+g.jobs,0),notCollected,notProvided,unresolved,nonAnnual};
  }
  return summary;
}

const CSV_FIELDS = ['studyId', 'jobKey', 'contentHash', 'cityGroup', 'roleFamily', 'requirementId', 'dimension', 'subject', 'necessity', 'logicPath', 'levelRaw', 'practice', 'minimumYears', 'maximumYears', 'languageScenario', 'evidenceTier', 'sourceField', 'quote'];
const cell = value => {
  const raw = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
};
export function renderRequirementsCsv(summary) {
  return [CSV_FIELDS, ...summary.details.map(detail => CSV_FIELDS.map(field => field === 'studyId' ? summary.studyId :
    field === 'necessity' ? (detail.effectiveNecessity ?? detail.necessity) : detail[field]))]
    .map(values => values.map(cell).join(',')).join('\r\n') + '\r\n';
}
