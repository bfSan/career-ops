import { readFileSync } from 'node:fs';
import { canonicalize, extractSkills } from '../skill-extract.mjs';
import { fingerprint } from './store.mjs';
import {dateFactStatus} from './observation-facts.mjs';

const sort = values => [...values].sort();
const norm = value => value.normalize('NFKC').trim();
const unknownDate = () => ({ value: null, status: 'not_collected' });

// Additive index: original semantic requirements and immutable reports stay intact.
// Token mentions are not an assertion that every mentioned technology is mandatory.
export function connectMarket(study, summary, state) {
  const details = summary.details.filter(d => d.dimension === 'skill' && d.logic === 'single').map(d => {
    const subjectSkills = sort(extractSkills(norm(d.subject)));
    const evidenceSkills = extractSkills(norm(d.quote));
    const skills = subjectSkills.filter(skill => evidenceSkills.has(skill));
    const mapping = skills.length === 0 ? (subjectSkills.length ? 'unsupported_by_evidence' : 'unmapped') :
      skills.length === 1 && canonicalize(norm(d.subject)) === skills[0] ? 'exact_subject' : 'subject_mentions';
    return { jobKey: d.jobKey, contentHash: d.contentHash, requirementId: d.requirementId, logicPath: d.logicPath,
      cityGroup: d.cityGroup, roleFamily: d.roleFamily, subject: d.subject, skills, subjectSkills, mapping,
      included: !d.inferred && d.coverage === 'reviewed',
      kind: `${d.alternative ? 'alternative_' : ''}${d.effectiveNecessity}`,
      evidenceTier: d.evidenceTier, inheritedInferred: d.inferred, coverage: d.coverage,
      levelRaw: d.levelRaw, practice: d.practice, evidence: d.evidence };
  });
  const groupMap = new Map();
  const scopes = (cityGroup, roleFamily) => [
    { scope: 'all', cityGroup: null, roleFamily: null },
    { scope: 'role_family', cityGroup: null, roleFamily },
    { scope: 'city_role_family', cityGroup, roleFamily },
  ];
  for (const g of summary.missingness.groups.filter(g => g.dimension === 'skill')) {
    for (const dimensions of scopes(g.cityGroup, g.roleFamily)) {
      const key = JSON.stringify(dimensions);
      if (!groupMap.has(key)) groupMap.set(key, { ...dimensions, reviewed: new Set(), notReviewed: new Set() });
      const group = groupMap.get(key);
      g.reviewedJobKeys.forEach(k => group.reviewed.add(k));
      g.notReviewedJobKeys.forEach(k => group.notReviewed.add(k));
    }
  }
  const counts = new Map();
  for (const d of details.filter(d => d.included)) {
    for (const dimensions of scopes(d.cityGroup, d.roleFamily)) {
      for (const skill of d.skills) {
        const key = JSON.stringify([dimensions, skill, d.kind]);
        if (!counts.has(key)) counts.set(key, { ...dimensions, skill, kind: d.kind, jobs: new Set(), exact: new Set() });
        const row = counts.get(key); row.jobs.add(d.jobKey);
        if (d.mapping === 'exact_subject') row.exact.add(d.jobKey);
      }
    }
  }
  const groups = [...groupMap.values()].map(({ reviewed, notReviewed, ...g }) => ({ ...g,
    reviewedJobKeys: sort(reviewed), notReviewedJobKeys: sort(notReviewed), denominator: reviewed.size }));
  const rows = [...counts.values()].map(({ jobs, exact, ...r }) => {
    const group = groupMap.get(JSON.stringify({ scope: r.scope, cityGroup: r.cityGroup, roleFamily: r.roleFamily }));
    return { ...r, count: jobs.size, denominator: group.reviewed.size, jobKeys: sort(jobs), exactSubjectJobKeys: sort(exact) };
  }).sort((a, b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  const timeline = [...study.sources].sort((a, b) => a.jobKey.localeCompare(b.jobKey, 'en')).map(s => {
    const job = state.jobs[s.jobKey], version = job?.versions?.find(v => v.hash === s.contentHash);
    // A later import may backfill an older observation of the same version.
    // Version metadata reflects first insertion, so include the observation log.
    const versionTimes = (job?.observations ?? []).filter(o => o.status === 'ok' && o.hash === s.contentHash).map(o => o.at);
    if (version?.observedAt) versionTimes.push(version.observedAt);
    return { jobKey: s.jobKey, contentHash: s.contentHash, capturePath: s.capturePath,
      frozenObservedAt: s.observedAt, frozenAttempt: s.latestAttempt,
      storeRecordAvailable: !!job, firstSuccessfullyCapturedAt: job?.firstSeenAt ?? null,
      lastSuccessfullyCapturedAt: job?.lastSeenAt ?? null,
      selectedVersionFirstCapturedAt: versionTimes.sort()[0] ?? null,
      selectedVersionMatchesLatest: job?.latest ? job.latest.hash === s.contentHash : null,
      latestAttempt: job?.lastAttempt ?? null,
      successfulObservations: job?.observations?.filter(o => o.status === 'ok').length ?? null,
      publishedAt: study.manifest.schemaVersion===2?dateFactStatus(s.facts,'published'):unknownDate(),
      sourceUpdatedAt: study.manifest.schemaVersion===2?dateFactStatus(s.facts,'updated'):unknownDate(),
      validThrough: study.manifest.schemaVersion===2?dateFactStatus(s.facts,'valid_through'):unknownDate(), availabilityNow: 'not_rechecked' };
  });
  const included = details.filter(d => d.included), mapped = included.filter(d => d.skills.length);
  const jobs = Object.values(state.jobs);
  const inventory = { jobs: jobs.length, completeJds: jobs.filter(j => j.latest).length,
    platforms: Object.fromEntries(sort(new Set(jobs.map(j => j.platform))).map(p => [p, jobs.filter(j => j.platform === p && j.latest).length])) };
  const modules = [
    { id: 'china-jobs → prepare → validate/report', status: summary.complete ? 'connected' : 'partial', reason: `${summary.jobs} frozen jobs; ${summary.complete ? 'complete' : 'partial'} semantic review` },
    { id: 'skill-extract', status: 'connected', reason: `${mapped.length}/${included.length} reviewed non-inferred skill leaves mapped; unmatched leaves retained; token mentions are not mandatory-skill counts` },
    { id: 'capture-timeline', status: 'connected', reason: `${timeline.filter(j => j.storeRecordAvailable).length}/${timeline.length} selected jobs joined to historical store observations; no live recheck` },
    { id: 'posting-dates', status: study.manifest.schemaVersion===2?'connected':'needs_inputs', reason: 'v2 evidence facts feed core date filters and history; v1 archives retain not_collected; missing source dates are never inferred' },
    { id: 'salary-gap', status: 'needs_inputs', reason: `${summary.missingness.salary.readable}/${summary.jobs} salaries readable; upstream needs evaluated advertised compensation and personal salary observations; raw market text is not that contract` },
    { id: 'check-liveness', status: 'implemented', reason: 'scan --verify and check-liveness share the opt-in domestic adapter; one owned session, at most five jobs and no fallback after a gate; no live check performed by connect' },
    { id: 'detect-reposts', status: 'connected', reason: 'Explicit selected-job core scans write scan-history.tsv for the original repost detector; multiple URLs across dates are required; research capture alone is not a repost' },
    { id: 'upskill', status: 'deferred', reason: 'Personal scored reports, tracker and confirmed skill evidence are required; market frequency must not be passed off as personal gaps' },
    { id: 'pipeline/oferta/tracker/interview', status: 'deferred', reason: 'Existing personal workflow remains available for a later explicitly selected set of jobs; no automatic queue or application' },
  ];
  return { schemaVersion: study.manifest.schemaVersion, studyId: summary.studyId, sourceDigest: summary.sourceDigest, analysisDigest: summary.analysisDigest,
    implementationDigest: fingerprint(['../skill-extract.mjs', './market-summary.mjs', './market-connections.mjs', '../china-market.mjs'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))),
    complete: summary.complete, jobs: summary.jobs, inventory,
    skills: { vocabulary: 'career-ops/skill-extract.mjs', reviewedJobs: groups.find(g => g.scope === 'all')?.denominator ?? 0,
      eligibleLeaves: included.length, mappedLeaves: mapped.length, unmappedLeaves: included.length - mapped.length,
      excludedLeaves: details.length - included.length, distinctSkills: new Set(mapped.flatMap(d => d.skills)).size,
      groups, rows, details },
    salary: summary.missingness.salary, conflicts: summary.missingness.conflicts, timeline, modules,
    ...(study.manifest.schemaVersion===2?{compensationGroups:summary.compensationGroups,factMissingness:{compensation:summary.missingness.compensation,postingDate:summary.missingness.postingDate}}:{}) };
}
