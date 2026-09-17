import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readStudy } from './market-study.mjs';
import { fingerprint, openStore, storePath } from './store.mjs';
import { jobIdentity } from './platforms.mjs';
import {toAnnualSalary} from '../compensation.mjs';
import {publishedDateFact,toPostedAt} from '../posting-dates.mjs';
import {validateObservationFacts} from './observation-facts.mjs';
import {loadMarketSelection} from './market-workflow.mjs';

const PLATFORMS = new Set(['boss', 'liepin', 'linkedin']);
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

function inside(base, target) {
  const rel = relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function validateFrozenArchive(dataRoot, source) {
  try {
    if (!source || !/^(boss:[\w-]+|liepin:(?:job|a)-\d+|linkedin:\d+)$/.test(source.jobKey)
      || !/^[a-f0-9]{20}$/.test(source.contentHash)) throw new Error('invalid source identity/hash');
    const [platform, id] = source.jobKey.split(':');
    if (source.capturePath !== `jds/china/${platform}-${id}-${source.contentHash}.md`) throw new Error('capture filename binding mismatch');
    if (typeof source.fields?.description !== 'string' || source.fields.description.trim().length < 40
      || typeof source.fields.title !== 'string' || !source.fields.title.trim()) throw new Error('incomplete JD');
    const root = realpathSync(dataRoot);
    const captureRoot = realpathSync(join(root, 'jds', 'china'));
    const lexical = resolve(root, source.capturePath);
    if (!inside(captureRoot, lexical)) throw new Error('capture path escapes archive root');
    let current = root;
    for (const segment of relative(root, lexical).split(sep)) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink()) throw new Error('symlink in capture path');
    }
    const stat = lstatSync(lexical);
    if (!stat.isFile() || stat.size > MAX_CAPTURE_BYTES) throw new Error('invalid capture file');
    const { listingText: _listingText, ...content } = source.fields;
    if (fingerprint(content) !== source.contentHash) throw new Error('content hash mismatch');
    const archive = readFileSync(lexical, 'utf8');
    const archivedUrl = archive.match(/^\*\*Source:\*\*\s*(.*?)\s*$/m)?.[1];
    const archivedId = archive.match(/^\*\*Job ID:\*\*\s*(.*?)\s*$/m)?.[1];
    const identity = jobIdentity(source.jobKey.split(':', 1)[0], archivedUrl);
    if (identity.key !== source.jobKey || identity.url !== archivedUrl) throw new Error('identity mismatch');
    const archivedDescription = archive.match(/## Job Description \(archived verbatim\)\n\n(`{3,})text\n([\s\S]*?)\n\1\n?$/)?.[2];
    if (archivedUrl !== identity.url || archivedId !== identity.id || archivedDescription !== source.fields.description) throw new Error('archive binding mismatch');
    return identity;
  } catch (error) {
    throw new Error(`archive_corrupt: ${source?.jobKey || 'unknown'}: ${error.message}`);
  }
}

function readOptionalStore(dataRoot) {
  if (!existsSync(storePath(dataRoot))) return null;
  try { return openStore(dataRoot); }
  catch (error) { throw new Error(`store_corrupt: ${error.message}`); }
}

function knownClosed(source, store) {
  const job = store?.jobs?.[source.jobKey];
  const states = [
    ...(job?.observations || (job?.lastAttempt ? [job.lastAttempt] : [])).filter(o => ['closed', 'ok'].includes(o.status))
      .map(o => ({ at: o.at, closed: o.status === 'closed' })),
    ...(job?.availabilityObservations || []).filter(o => ['active', 'expired'].includes(o.result))
      .map(o => ({ at: o.checkedAt, closed: o.result === 'expired' })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Keep the legacy lastAttempt usable even when observations were absent.
  if (job?.lastAttempt?.status === 'closed' && (!states[0] || Date.parse(job.lastAttempt.at) >= Date.parse(states[0].at))) return true;
  return states[0]?.closed === true;
}

export function projectFrozenJob(source, identity, studyId) {
  const platform = identity.key.split(':')[0];
  if(source.facts)validateObservationFacts(source.facts);
  const compensation=source.facts?.compensation,dates=source.facts?.dates;
  const salary=toAnnualSalary(compensation),postedAt=toPostedAt(publishedDateFact({dates}));
  return {
    url: identity.url, title: source.fields.title, company: source.fields.company,
    location: source.fields.location, description: source.fields.description,
    ...(source.fields.companySizeRaw?{companySizeRaw:source.fields.companySizeRaw,
      ...(source.fields.companySizeEvidence?{companySizeEvidence:structuredClone(source.fields.companySizeEvidence)}:{})}:{}),
    ...(compensation?{compensation:structuredClone(compensation)}:{}),...(dates?{dates:structuredClone(dates)}:{}),
    ...(salary?{salary}:{}),...(postedAt!==undefined?{postedAt}:{}),
    sourceRef: { schemaVersion: 1, providerId: `career-${platform}`, platform, jobKey: source.jobKey,
      contentHash: source.contentHash, capturePath: source.capturePath,
      observedAt: source.observedAt, availability: 'not_rechecked', studyId },
  };
}

export function createArchiveProvider(platform) {
  if (!PLATFORMS.has(platform)) throw new Error(`unsupported archive platform: ${platform}`);
  const id = `career-${platform}`;
  return { id, async fetch(entry, ctx) {
    if (!entry || typeof entry.study_id !== 'string' || !entry.study_id) throw new Error('study_id is required');
    if (!ctx?.dataRoot) throw new Error('dataRoot is required');
    const market=loadMarketSelection(ctx.dataRoot,entry.market_pool,entry.market_configuration_hash);
    let study;
    try { study = readStudy(ctx.dataRoot, entry.study_id); }
    catch (error) {
      if (error?.code === 'ENOENT' || /missing|not found|ENOENT/.test(error.message)) throw new Error(`study_not_found: ${entry.study_id}`);
      throw new Error(`study_corrupt: ${entry.study_id}: ${error.message}`);
    }
    const sources = study.sources.filter(source => source.jobKey?.startsWith(`${platform}:`));
    if (!sources.length) throw new Error(`platform_archive_unavailable: ${platform}`);
    const store = readOptionalStore(ctx.dataRoot);
    return sources.filter(source => !knownClosed(source, store)&&(!market||market.has(source.jobKey,source.contentHash))).map(source => {
      const identity = validateFrozenArchive(ctx.dataRoot, source);
      return projectFrozenJob(source, identity, study.manifest.studyId);
    });
  } };
}
