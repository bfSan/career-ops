import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fingerprint, openStore } from './store.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';
import {selectObservationFacts,validateObservationFacts} from './observation-facts.mjs';
import {validateBundle,DIMENSIONS} from './market-analysis.mjs';

const STUDY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateStudyId(studyId) {
  if (typeof studyId !== 'string' || !STUDY_ID.test(studyId)) throw new Error('invalid studyId');
}

function validateOptions(options) {
  const keys=['createdAt', 'scope', 'selected', 'studyId',...(Object.hasOwn(options,'schemaVersion')?['schemaVersion']:[])].sort();
  if (!hasExactKeys(options, keys)||!['undefined','number'].includes(typeof options.schemaVersion)
    ||(options.schemaVersion!==undefined&&![1,2].includes(options.schemaVersion))) throw new Error('invalid or unknown study option');
  validateStudyId(options.studyId);
  if (!hasExactKeys(options.scope, ['cities', 'keywords', 'queryUrls'])
    || !Array.isArray(options.scope.cities) || !options.scope.cities.every(value => typeof value === 'string')
    || !Array.isArray(options.scope.keywords) || !options.scope.keywords.every(value => typeof value === 'string')
    || !Array.isArray(options.scope.queryUrls) || !options.scope.queryUrls.every(value => typeof value === 'string')) {
    throw new Error('invalid scope');
  }
  if (!Array.isArray(options.selected) || options.selected.length === 0) throw new Error('selected must be non-empty');
  const seen = new Set();
  for (const item of options.selected) {
    if (!hasExactKeys(item, ['contentHash', 'jobKey']) || typeof item.jobKey !== 'string' || typeof item.contentHash !== 'string') throw new Error('invalid selected entry');
    if (seen.has(item.jobKey)) throw new Error(`duplicate selected jobKey: ${item.jobKey}`);
    seen.add(item.jobKey);
  }
  if (typeof options.createdAt !== 'string' || !Number.isFinite(Date.parse(options.createdAt))) throw new Error('invalid createdAt');
}

export function buildStudy(state, options) {
  validateOptions(options);
  if (!state || typeof state !== 'object' || !state.jobs || !Array.isArray(state.runs)) throw new Error('invalid store state');
  const sources = options.selected.map(({ jobKey, contentHash }) => {
    const job = state.jobs[jobKey];
    if (!job) throw new Error(`unknown_job: ${jobKey}`);
    if (!job.latest || job.latest.hash !== contentHash) throw new Error(`selected_version_unavailable: ${jobKey}`);
    const { hash, capturePath, observedAt, ...content } = job.latest;
    if (fingerprint(content) !== hash) throw new Error(`content_hash_mismatch: ${jobKey}`);
    if (typeof content.description !== 'string' || content.description.trim().length < 40) throw new Error(`incomplete_description: ${jobKey}`);
    const same = job.lastAttempt?.status === 'ok' && job.lastAttempt.hash === hash && job.lastAttempt.at === observedAt;
    return {
      jobKey,
      contentHash: hash,
      capturePath,
      observedAt,
      latestAttempt: { status: job.lastAttempt?.status, at: job.lastAttempt?.at },
      listingBinding: same ? 'same_observation' : 'unbound',
      fields: { ...structuredClone(content), listingText: same ? (job.latestListing?.listingText || '') : '' },
      queryRefs: state.runs.filter(run => Array.isArray(run.seen) && run.seen.includes(jobKey)).map(run => ({
        runId: run.id, searchUrl: run.searchUrl, startedAt: run.startedAt,
      })),
      ...(options.schemaVersion===2?{facts:selectObservationFacts(job,{contentHash:hash,observedAt})}:{}),
    };
  }).sort((a, b) => a.jobKey.localeCompare(b.jobKey));
  const scope = structuredClone(options.scope);
  const manifest = {
    schemaVersion: options.schemaVersion??1,
    studyId: options.studyId,
    createdAt: options.createdAt,
    sourceDigest: fingerprint({ scope, sources }),
    scope,
    selected: sources.map(({ jobKey, contentHash }) => ({ jobKey, contentHash })),
  };
  return { manifest, sources };
}

function isInside(base, target) {
  const rel = relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function validatePathChain(root, segments, { requireFinal = false } = {}) {
  const canonicalRoot = realpathSync(root);
  let current = canonicalRoot;
  let missing = false;
  for (const segment of segments) {
    current = join(current, segment);
    if (missing) continue;
    let stat;
    try { stat = lstatSync(current); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missing = true;
      continue;
    }
    if (stat.isSymbolicLink()) throw new Error(`unsafe symlink in data path: ${current}`);
    const actual = realpathSync(current);
    if (!isInside(canonicalRoot, actual)) throw new Error(`data path escapes root: ${current}`);
  }
  if (requireFinal && missing) throw new Error(`required data path missing: ${current}`);
  return current;
}

function validatedStudyDir(root, studyId, { requireFinal = false } = {}) {
  return validatePathChain(root, ['data', 'china', 'research', studyId], { requireFinal });
}

function validateCapture(root, source) {
  const canonicalRoot = realpathSync(root);
  const captureRoot = validatePathChain(canonicalRoot, ['jds', 'china'], { requireFinal: true });
  if (typeof source.capturePath !== 'string') throw new Error(`invalid capture path: ${source.jobKey}`);
  const lexical = resolve(canonicalRoot, source.capturePath);
  if (!isInside(captureRoot, lexical)) throw new Error(`capture outside jds/china: ${source.jobKey}`);
  let actual;
  try { actual = realpathSync(lexical); }
  catch { throw new Error(`missing capture: ${source.jobKey}`); }
  if (!isInside(captureRoot, actual)) throw new Error(`capture symlink outside jds/china: ${source.jobKey}`);
  const stat = lstatSync(actual);
  if (!stat.isFile() || stat.size > MAX_CAPTURE_BYTES) throw new Error(`invalid capture file: ${source.jobKey}`);
  const archive = readFileSync(actual, 'utf8');
  const jobId = source.jobKey.slice(source.jobKey.indexOf(':') + 1);
  const archivedJobId = archive.match(/^\*\*Job ID:\*\*\s*(.*?)\s*$/m)?.[1];
  if (archivedJobId !== jobId || !archive.includes(source.fields.description)) {
    throw new Error(`archive content mismatch: ${source.jobKey}`);
  }
}

function privateJsonWrite(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function prepareStudy(root, options) {
  validateOptions(options);
  validatedStudyDir(root, options.studyId);
  const state = openStore(root);
  const study = buildStudy(state, options);
  return publishStudy(root, study);
}

// Accept already archived provider-neutral snapshots through the same research contract.
// Source identity/provenance stays in fields; no domestic store entry is manufactured.
export async function prepareSourceStudy(root, options) {
  if (!hasExactKeys(options, ['studyId','createdAt','schemaVersion','scope','sources'].sort())
    || options.schemaVersion !== 2 || !Array.isArray(options.sources)) throw new Error('invalid source study option; sources require schema-version 2');
  const selected=options.sources.map(s=>({jobKey:s?.jobKey,contentHash:s?.contentHash}));
  validateOptions({studyId:options.studyId,createdAt:options.createdAt,schemaVersion:2,scope:options.scope,selected});
  validatedStudyDir(root, options.studyId);
  const sources=structuredClone(options.sources).sort((a,b)=>a.jobKey.localeCompare(b.jobKey));
  const scope=structuredClone(options.scope);
  const manifest={schemaVersion:2,studyId:options.studyId,createdAt:options.createdAt,
    sourceDigest:fingerprint({scope,sources}),scope,selected:sources.map(({jobKey,contentHash})=>({jobKey,contentHash}))};
  const study={manifest,sources};
  const validation=validateBundle(study,{schemaVersion:2,studyId:manifest.studyId,sourceDigest:manifest.sourceDigest,
    records:sources.map(s=>({jobKey:s.jobKey,contentHash:s.contentHash,analysisVersion:'market-v1',analyzedAt:options.createdAt,
      roleFamily:'unknown',roleFamilyEvidence:null,cityGroup:'unknown',cityEvidence:[],companyKey:null,companyEvidence:null,
      coverage:Object.fromEntries(DIMENSIONS.map(d=>[d,'not_reviewed'])),requirements:[],conflicts:[]}))});
  if (!validation.valid) throw new Error(`invalid source snapshot: ${validation.errors.map(e=>`${e.path}:${e.code}`).join('; ')}`);
  for (const s of sources) {
    if (s.fields.description.trim().length<40) throw new Error(`incomplete_description: ${s.jobKey}`);
    if (s.listingBinding==='unbound' && s.fields.listingText!=='') throw new Error(`unbound listing text: ${s.jobKey}`);
    if (s.listingBinding==='same_observation' && (s.latestAttempt.status!=='ok'||s.latestAttempt.at!==s.observedAt)) throw new Error(`invalid same-observation listing binding: ${s.jobKey}`);
  }
  return publishStudy(root,study);
}

async function publishStudy(root, study) {
  const studyId=study.manifest.studyId;
  const finalDir=validatedStudyDir(root,studyId);
  for (const source of study.sources) validateCapture(root, source);
  return withPipelineLock(finalDir, async () => {
    if (existsSync(finalDir)) throw new Error(`study already exists: ${studyId}`);
    const parent = dirname(finalDir);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temp = mkdtempSync(join(parent, `.${studyId}-`));
    try {
      privateJsonWrite(join(temp, 'manifest.json'), study.manifest);
      privateJsonWrite(join(temp, 'source-jobs.json'), study.sources);
      renameSync(temp, finalDir);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
    return study;
  });
}

function readJsonLimited(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) throw new Error(`invalid study file: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readStudy(root, studyId) {
  validateStudyId(studyId);
  const dir = validatedStudyDir(root, studyId, { requireFinal: true });
  const manifest = readJsonLimited(join(dir, 'manifest.json'));
  const sources = readJsonLimited(join(dir, 'source-jobs.json'));
  if (!manifest || ![1,2].includes(manifest.schemaVersion) || manifest.studyId !== studyId || !Array.isArray(sources)) throw new Error('invalid study manifest');
  for(const source of sources){
    if(manifest.schemaVersion===1&&Object.hasOwn(source,'facts'))throw new Error('v1 source does not support facts');
    if(manifest.schemaVersion===2){
      if(!Object.hasOwn(source,'facts'))throw new Error('v2 source requires facts');
      if(source.facts!==null)validateObservationFacts(source.facts);
      if(source.facts?.dates?.some(f=>Date.parse(f.observedAt)>Date.parse(source.observedAt)))throw new Error('future source facts');
    }
  }
  const selected = sources.map(source => ({ jobKey: source.jobKey, contentHash: source.contentHash }));
  if (JSON.stringify(manifest.selected) !== JSON.stringify(selected)) throw new Error('manifest selected does not match sources');
  if (manifest.sourceDigest !== fingerprint({ scope: manifest.scope, sources })) throw new Error('sourceDigest mismatch');
  return { manifest, sources };
}
