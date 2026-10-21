import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { jobIdentity, extractPage } from './platforms.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { openStore, saveStore, storePath, recordObservation, fingerprint, atomicPrivateWrite } from './store.mjs';
import { liepinBatchPolicy } from './liepin-batch-policy.mjs';
import { bossBatchPolicy } from './boss-batch-policy.mjs';
import { loadNativeSalaryFont, normalizeSalary } from './salary.mjs';

const METHODS = new Set(['browser_accessibility', 'browser_dom', 'browser_extension', 'manual_copy']);
const evidenceBoundary = {
  evidence: 'browser_self_reported',
  independentAttestation: false,
  note: '本地校验只检查浏览器自报回执的内部一致性，不是第三方认证，也不证明市场覆盖或岗位仍开放。',
};

// Explicit import of text the user/assistant could see. No browser, cookie, or HTTP access.
// batchContext, when supplied, is the WHOLE schema-2 envelope, never its batch field.
export async function importJobs(root, { platform, records, batchContext = null }) {
  const verified = batchContext !== null && batchContext !== undefined;
  let envelope = null;
  const batchPolicy = platform === 'liepin' ? liepinBatchPolicy : platform === 'boss' ? bossBatchPolicy : null;
  if (verified) {
    if (!batchPolicy) throw new Error('该平台不支持有边界可见批次回执');
    envelope = structuredClone(batchContext);
    batchPolicy.validateReceipt(envelope);
    if (records !== undefined && JSON.stringify(records) !== JSON.stringify(envelope.records)) {
      throw new Error('Import records differ from the complete batch envelope');
    }
    records = envelope.records;
  }
  if (!Array.isArray(records) || !records.length || records.length > 100) throw new Error('Import requires 1–100 records');
  const inputs = records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid import record');
    const url = verified ? batchPolicy.jobUrl(record.url) : record.url;
    const identity = jobIdentity(platform, url);
    if (record.complete !== true) throw new Error('Import requires an explicitly confirmed complete description');
    if (!METHODS.has(record.captureMethod)) throw new Error('Unknown captureMethod');
    if (typeof record.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.observedAt) || !Number.isFinite(Date.parse(record.observedAt))) throw new Error('A valid observedAt ISO timestamp is required');
    if (typeof record.title !== 'string' || !record.title.trim()) throw new Error('A job title is required');
    if (typeof record.description !== 'string' || record.description.trim().length < 40 || record.description.length > 200000) throw new Error('A complete description of 40–200000 characters is required');
    if (extractPage({ platform, kind: 'notice', sourceText: record.description + '\n' + (record.sourceText || '') }).status !== 'ok') throw new Error('Posting is gated, incomplete, or closed');
    const input = { platform, url: identity.url, status: 'ok', observedAt: record.observedAt, title: record.title, description: record.description, captureMethod: record.captureMethod, complete: true };
    for (const key of ['company', 'location', 'salaryRaw', 'experience', 'education', 'listingText', 'sourceText']) {
      if (record[key] !== undefined) {
        if (typeof record[key] !== 'string' || record[key].length > 300000) throw new Error(`Invalid ${key}`);
        input[key] = record[key];
      }
    }
    // Preserve supplied search metadata, even for legacy arrays, but never
    // promote it to validated provenance without a complete successful receipt.
    if (record.searchContext !== undefined) {
      if (!record.searchContext || typeof record.searchContext !== 'object' || Array.isArray(record.searchContext) || JSON.stringify(record.searchContext).length > 16384) throw new Error('Invalid searchContext');
      input.searchContext = structuredClone(record.searchContext);
    }
    input.tags = Array.isArray(record.tags) ? record.tags.filter(t => typeof t === 'string').slice(0, 100) : [];
    if (record.companySizeRaw !== undefined) {
      if (typeof record.companySizeRaw !== 'string' || record.companySizeRaw.length > 128) throw new Error('Invalid companySizeRaw');
      input.companySizeRaw = record.companySizeRaw.trim();
      if (input.companySizeRaw) input.companySizeEvidence = { field: 'assistedCompanyMetadata', quote: input.companySizeRaw };
    }
    input.advertised = record.advertised === true;
    input.qualityFlags = ['assisted_capture'];
    if (/[\uE000-\uF8FF]/.test(input.salaryRaw || '')) input.qualityFlags.push('encoded_salary');
    return input;
  });
  // BOSS renders some salary digits in a private-use font, so salaryRaw can be
  // missing its numbers. Captures record the stylesheet URLs it was rendered
  // with; recover the text from that pinned public font. Any failure leaves the
  // raw value and the encoded_salary flag untouched rather than inventing digits.
  for (const input of inputs) {
    if (!/[\uE000-\uF8FF]/.test(input.salaryRaw || '')) continue;
    try {
      const fonts = await loadNativeSalaryFont(input, { timeoutMs: 8000 });
      if (!fonts.length) continue;
      const decoded = normalizeSalary(input, fonts);
      if (decoded.salaryText && !/[\uE000-\uF8FF]/.test(decoded.salaryText)) {
        input.salaryText = decoded.salaryText;
        if (decoded.salaryEvidence) input.salaryEvidence = decoded.salaryEvidence;
        input.qualityFlags = input.qualityFlags.filter(flag => flag !== 'encoded_salary');
      }
    } catch { /* keep raw salary and flag; never guess */ }
  }
  const provenance = {
    status: verified ? 'validated' : 'legacy',
    ...(verified ? {} : { reason: 'insufficient_search_provenance' }),
    ...evidenceBoundary,
  };
  const receipt = verified
    // Keep the complete browser envelope (including every searchContext field)
    // as the durable receipt; normalized inputs are only the store write form.
    ? { ...envelope, records: structuredClone(envelope.records), provenance }
    : { schemaVersion: 2, kind: 'assisted_job_import', records: inputs, provenance };
  // Re-validate the exact persisted form too, before even acquiring the lock
  // (the lock creates directories). Invalid/fake envelopes cause zero writes.
  if (verified) batchPolicy.validateReceipt(receipt);
  const path = `data/china/imports/${fingerprint(receipt)}.json`;
  const receiptPath = join(root, path);
  const content = `${JSON.stringify(receipt, null, 2)}\n`;

  return withPipelineLock(storePath(root), async () => {
    const state = openStore(root);
    // Hash-addressed historical receipts are immutable. The file alone is not
    // the idempotency marker: a crash may have written it before saving store.
    if (existsSync(receiptPath)) {
      if (readFileSync(receiptPath, 'utf8') !== content) throw new Error('Existing import receipt differs; refusing to overwrite history');
    } else {
      atomicPrivateWrite(receiptPath, content);
    }
    let newVersions = 0, observations = 0;
    const jobs = [];
    for (const input of inputs) {
      const key = jobIdentity(platform, input.url).key;
      const previous = state.jobs[key];
      const at = new Date(input.observedAt).toISOString();
      const existingObservation = previous?.observations?.find(observation => observation.source?.path === path && observation.at === at);
      if (existingObservation) {
        const version = previous.versions.find(v => v.hash === existingObservation.hash);
        jobs.push({ key, capturePath: version?.capturePath || null, observedAt: at, versionCreated: false, observationCreated: false });
        continue;
      }
      const before = previous?.versions.length || 0;
      const source = {
        captureMethod: input.captureMethod,
        path,
        provenance: provenance.status,
        ...(verified ? { batchId: envelope.batch.id, city: envelope.batch.city, keyword: envelope.batch.keyword } : { reason: 'insufficient_search_provenance' }),
        ...(input.searchContext ? { searchContext: structuredClone(input.searchContext) } : {}),
      };
      const job = recordObservation(root, state, { ...input, source });
      const versionCreated = job.versions.length > before;
      newVersions += Number(versionCreated);
      observations++;
      const hash = job.observations.at(-1).hash;
      jobs.push({ key, capturePath: job.versions.find(v => v.hash === hash).capturePath, observedAt: at, versionCreated, observationCreated: true });
    }
    if (observations) saveStore(root, state);
    return { imported: inputs.length, observations, newVersions, idempotent: observations === 0, provenance, receiptPath, ...(verified ? { batchId: envelope.batch.id } : {}), jobs };
  });
}
