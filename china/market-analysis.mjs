import { fingerprint } from './store.mjs';
import {validateObservationFacts} from './observation-facts.mjs';

export const DIMENSIONS = ['experience', 'language', 'skill', 'education', 'delivery', 'domain', 'work_conditions'];
const FAMILIES = ['application_agent', 'platform_infra', 'algorithm_model', 'engineering_solution', 'other_technical', 'unknown'];
const EVIDENCE_KEYS = ['field', 'start', 'end', 'quote'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = v => typeof v === 'string' && v.trim().length > 0;
const date = v => string(v) && Number.isFinite(Date.parse(v));
const strings = v => Array.isArray(v) && v.every(string);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

export function checkEvidence(source, e) {
  if (!object(source) || !object(source.fields) || !exact(e, EVIDENCE_KEYS) || !['description', 'listingText', 'location', 'company'].includes(e.field)) return false;
  if (e.field === 'listingText' && source.listingBinding !== 'same_observation') return false;
  const raw = source.fields[e.field];
  return typeof raw === 'string' && string(e.quote) && Number.isInteger(e.start) && Number.isInteger(e.end) &&
    e.start >= 0 && e.end > e.start && e.end <= raw.length && raw.slice(e.start, e.end) === e.quote;
}

export function validateBundle(study, bundle) {
  const errors = [], missingJobKeys = [], unreviewed = [];
  const error = (jobKey, path, code) => errors.push({ jobKey: string(jobKey) ? jobKey : null, path, code });
  const shape = (v, keys, path, jobKey = null) => {
    if (!object(v)) { error(jobKey, path, 'invalid_type'); return false; }
    for (const k of keys) if (!Object.hasOwn(v, k)) error(jobKey, `${path}.${k}`, 'missing_field');
    for (const k of Object.keys(v)) if (!keys.includes(k)) error(jobKey, `${path}.${k}`, 'unsupported_field');
    return true;
  };
  const check = (ok, path, code = 'invalid_value', jobKey = null) => { if (!ok) error(jobKey, path, code); };
  const finish = () => ({ valid: errors.length === 0, complete: errors.length === 0 && unreviewed.length === 0, errors, missingJobKeys, unreviewed });
  if (!shape(study, ['manifest', 'sources'], 'study')) return finish();
  const m = study.manifest;
  if (!shape(m, ['schemaVersion', 'studyId', 'createdAt', 'sourceDigest', 'scope', 'selected'], 'study.manifest')) return finish();
  check([1,2].includes(m.schemaVersion), 'study.manifest.schemaVersion');
  check(string(m.studyId) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(m.studyId), 'study.manifest.studyId');
  check(date(m.createdAt), 'study.manifest.createdAt');
  if (shape(m.scope, ['cities', 'keywords', 'queryUrls'], 'study.manifest.scope')) {
    for (const k of ['cities', 'keywords', 'queryUrls']) check(strings(m.scope[k]), `study.manifest.scope.${k}`);
  }
  if (!Array.isArray(study.sources) || !Array.isArray(m.selected)) { error(null, 'study', 'invalid_type'); return finish(); }
  check(study.sources.length > 0, 'study.sources', 'empty_sources');
  const sourceMap = new Map();
  for (const [i, s] of study.sources.entries()) {
    const p = `study.sources[${i}]`;
    if (!shape(s, ['jobKey', 'contentHash', 'capturePath', 'observedAt', 'latestAttempt', 'listingBinding', 'fields', 'queryRefs',...(m.schemaVersion===2?['facts']:[])], p)) continue;
    if(m.schemaVersion===2&&s.facts!==null){
      try{validateObservationFacts(s.facts);check(!s.facts.dates?.some(f=>Date.parse(f.observedAt)>Date.parse(s.observedAt)),`${p}.facts`,'future_facts');}
      catch{error(s.jobKey,`${p}.facts`,'invalid_facts');}
    }
    for (const k of ['jobKey', 'contentHash', 'capturePath']) check(string(s[k]), `${p}.${k}`);
    check(date(s.observedAt), `${p}.observedAt`);
    if (shape(s.latestAttempt, ['status', 'at'], `${p}.latestAttempt`)) { check(string(s.latestAttempt.status), `${p}.latestAttempt.status`); check(date(s.latestAttempt.at), `${p}.latestAttempt.at`); }
    check(['same_observation', 'unbound'].includes(s.listingBinding), `${p}.listingBinding`);
    check(object(s.fields), `${p}.fields`);
    if (object(s.fields)) {
      const { listingText, ...content } = s.fields;
      check(typeof listingText === 'string', `${p}.fields.listingText`);
      check(string(s.fields.description), `${p}.fields.description`);
      try { check(fingerprint(content) === s.contentHash, `${p}.contentHash`, 'content_hash_mismatch'); } catch { error(null, `${p}.fields`, 'invalid_content'); }
    }
    check(Array.isArray(s.queryRefs), `${p}.queryRefs`);
    if (Array.isArray(s.queryRefs)) s.queryRefs.forEach((q, j) => {
      if (shape(q, ['runId', 'searchUrl', 'startedAt'], `${p}.queryRefs[${j}]`)) {
        check(string(q.runId) && string(q.searchUrl) && date(q.startedAt), `${p}.queryRefs[${j}]`);
      }
    });
    if (string(s.jobKey)) {
      check(!sourceMap.has(s.jobKey), `${p}.jobKey`, 'duplicate_source'); sourceMap.set(s.jobKey, s);
    }
  }
  const selected = new Set();
  m.selected.forEach((s, i) => {
    const p = `study.manifest.selected[${i}]`;
    if (!shape(s, ['jobKey', 'contentHash'], p)) return;
    check(string(s.jobKey) && string(s.contentHash), p);
    check(!selected.has(s.jobKey), p, 'duplicate_selected'); selected.add(s.jobKey);
    check(sourceMap.has(s.jobKey) && sourceMap.get(s.jobKey).contentHash === s.contentHash, p, 'selected_source_mismatch');
  });
  check(selected.size === sourceMap.size && [...sourceMap.keys()].every(k => selected.has(k)), 'study.manifest.selected', 'selected_source_mismatch');
  try { check(m.sourceDigest === fingerprint({ scope: m.scope, sources: study.sources }), 'study.manifest.sourceDigest', 'source_digest_mismatch'); } catch { error(null, 'study', 'invalid_content'); }
  if (!shape(bundle, ['schemaVersion', 'studyId', 'sourceDigest', 'records'], 'bundle')) return finish();
  check(bundle.schemaVersion === m.schemaVersion, 'bundle.schemaVersion');
  check(bundle.studyId === m.studyId, 'bundle.studyId', 'study_id_mismatch');
  check(bundle.sourceDigest === m.sourceDigest, 'bundle.sourceDigest', 'source_digest_mismatch');
  if (!Array.isArray(bundle.records)) { error(null, 'bundle.records', 'invalid_type'); return finish(); }
  const seen = new Set();
  bundle.records.forEach((r, i) => {
    const p = `records[${i}]`, key = string(r?.jobKey) ? r.jobKey : null;
    if (!shape(r, ['jobKey', 'contentHash', 'analysisVersion', 'analyzedAt', 'roleFamily', 'roleFamilyEvidence', 'cityGroup', 'cityEvidence', 'companyKey', 'companyEvidence', 'coverage', 'requirements', 'conflicts'], p, key)) return;
    const ck = (ok, suffix, code) => check(ok, `${p}.${suffix}`, code, key);
    ck(string(r.jobKey), 'jobKey'); ck(!seen.has(r.jobKey), 'jobKey', 'duplicate_job'); seen.add(r.jobKey);
    const source = sourceMap.get(r.jobKey); ck(Boolean(source), 'jobKey', 'unknown_job');
    ck(string(r.contentHash) && r.contentHash === source?.contentHash, 'contentHash', 'content_hash_mismatch');
    ck(r.analysisVersion === 'market-v1', 'analysisVersion'); ck(date(r.analyzedAt), 'analyzedAt');
    const ev = (e, suffix, fields) => ck(checkEvidence(source, e) && fields.includes(e?.field), suffix, 'invalid_evidence');
    const textFields = ['description', 'listingText'];
    ck(FAMILIES.includes(r.roleFamily), 'roleFamily');
    if (r.roleFamilyEvidence !== null || r.roleFamily !== 'unknown') ev(r.roleFamilyEvidence, 'roleFamilyEvidence', textFields);
    ck([...(Array.isArray(m.scope?.cities) ? m.scope.cities : []), 'multiple', 'remote', 'unknown', 'conflict', 'outside_scope'].includes(r.cityGroup), 'cityGroup');
    ck(Array.isArray(r.cityEvidence), 'cityEvidence');
    if (Array.isArray(r.cityEvidence)) {
      ck(r.cityGroup === 'unknown' || r.cityEvidence.length > 0, 'cityEvidence', 'missing_evidence');
      r.cityEvidence.forEach((e, j) => ev(e, `cityEvidence[${j}]`, [...textFields, 'location']));
    }
    ck(r.companyKey === null || string(r.companyKey), 'companyKey');
    if (r.companyKey !== null || r.companyEvidence !== null) ev(r.companyEvidence, 'companyEvidence', [...textFields, 'company']);
    if (typeof r.companyKey === 'string') {
      const anonymous = /^(?:某|匿名|保密|未披露|未知|unknown|confidential)/i;
      ck(![r.companyKey, source?.fields?.company, r.companyEvidence?.quote].some(v => typeof v === 'string' && anonymous.test(v.trim())), 'companyKey', 'anonymous_company');
    }
    if (shape(r.coverage, DIMENSIONS, `${p}.coverage`, key)) for (const d of DIMENSIONS) {
      ck(['reviewed', 'not_reviewed'].includes(r.coverage[d]), `coverage.${d}`);
      if (r.coverage[d] === 'not_reviewed') unreviewed.push({ jobKey: key, dimension: d });
    }
    const ids = new Set(); let count = 0;
    const node = (n, suffix, depth) => {
      if (++count > 500) { if (count === 501) ck(false, suffix, 'node_limit'); return; }
      if (depth > 8) { ck(false, suffix, 'depth_limit'); return; }
      if (!shape(n, ['id', 'dimension', 'subject', 'necessity', 'evidenceTier', 'evidence', 'levelRaw', 'practice', 'minimumYears', 'maximumYears', 'languageScenario', 'logic', 'alternatives'], `${p}.${suffix}`, key)) return;
      const nc = (ok, field, code) => ck(ok, `${suffix}.${field}`, code);
      nc(string(n.id), 'id'); nc(!ids.has(n.id), 'id', 'duplicate_requirement_id'); ids.add(n.id);
      nc(DIMENSIONS.includes(n.dimension), 'dimension'); nc(string(n.subject), 'subject');
      nc(['required', 'preferred', 'unspecified'].includes(n.necessity), 'necessity');
      nc(['stated', 'structural', 'inferred'].includes(n.evidenceTier), 'evidenceTier');
      nc(!(n.evidenceTier === 'inferred' && n.necessity === 'required'), 'necessity', 'inferred_required');
      ev(n.evidence, `${suffix}.evidence`, textFields);
      nc(n.levelRaw === null || string(n.levelRaw), 'levelRaw'); nc(strings(n.practice), 'practice');
      const validYears = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 80;
      for (const f of ['minimumYears', 'maximumYears']) nc(n[f] === null || validYears(n[f]), f);
      if (validYears(n.minimumYears) && validYears(n.maximumYears)) nc(n.minimumYears <= n.maximumYears, 'maximumYears', 'years_order');
      nc(Array.isArray(n.languageScenario) && n.languageScenario.every(s => ['reading', 'writing', 'meeting', 'customer', 'certificate', 'unspecified'].includes(s)), 'languageScenario');
      nc(['single', 'any', 'all'].includes(n.logic), 'logic'); nc(Array.isArray(n.alternatives), 'alternatives');
      if (Array.isArray(n.alternatives)) {
        nc(n.logic === 'single' ? n.alternatives.length === 0 : n.alternatives.length >= 2, 'alternatives', 'invalid_logic');
        for (let j = 0; j < n.alternatives.length && count <= 500; j++) node(n.alternatives[j], `${suffix}.alternatives[${j}]`, depth + 1);
      }
    };
    ck(Array.isArray(r.requirements), 'requirements');
    if (Array.isArray(r.requirements)) for (let j = 0; j < r.requirements.length && count <= 500; j++) node(r.requirements[j], `requirements[${j}]`, 1);
    ck(Array.isArray(r.conflicts), 'conflicts');
    if (Array.isArray(r.conflicts)) r.conflicts.forEach((c, j) => {
      const suffix = `conflicts[${j}]`;
      if (!shape(c, ['field', 'evidence', 'note'], `${p}.${suffix}`, key)) return;
      ck(string(c.field) && string(c.note), suffix);
      ck(Array.isArray(c.evidence) && c.evidence.length >= 2, `${suffix}.evidence`, 'insufficient_conflict_evidence');
      if (Array.isArray(c.evidence)) c.evidence.forEach((e, k) => ev(e, `${suffix}.evidence[${k}]`, [...textFields, 'location', 'company']));
    });
  });
  for (const key of sourceMap.keys()) if (!seen.has(key)) { missingJobKeys.push(key); error(key, 'records', 'missing_job'); }
  return finish();
}
