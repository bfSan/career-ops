import { join } from 'node:path';
import { jobIdentity, extractPage } from './platforms.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { openStore, saveStore, storePath, recordObservation, fingerprint, atomicPrivateWrite } from './store.mjs';

const METHODS = new Set(['browser_accessibility', 'browser_dom', 'manual_copy']);

// Explicit import of text the user/assistant could see. No browser, cookie, or HTTP access.
export async function importJobs(root, { platform, records }) {
  if (!Array.isArray(records) || !records.length || records.length > 100) throw new Error('Import requires 1–100 records');
  const inputs = records.map(record => {
    if (!record || typeof record !== 'object') throw new Error('Invalid import record');
    const identity = jobIdentity(platform, record.url);
    if (record.complete !== true) throw new Error('Import requires an explicitly confirmed complete description');
    if (!METHODS.has(record.captureMethod)) throw new Error('Unknown captureMethod');
    if (typeof record.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.observedAt) || !Number.isFinite(Date.parse(record.observedAt))) throw new Error('A valid observedAt ISO timestamp is required');
    if (typeof record.title !== 'string' || !record.title.trim()) throw new Error('A job title is required');
    if (typeof record.description !== 'string' || record.description.trim().length < 40 || record.description.length > 200000) throw new Error('A complete description of 40–200000 characters is required');
    if (extractPage({platform,kind:'notice',sourceText:record.description+'\n'+(record.sourceText || '')}).status!=='ok') throw new Error('Posting is gated, incomplete, or closed');
    const input = { platform, url: identity.url, status: 'ok', observedAt: record.observedAt, title: record.title, description: record.description, captureMethod: record.captureMethod, complete: true };
    for (const key of ['company', 'location', 'salaryRaw', 'experience', 'education', 'listingText', 'sourceText']) {
      if (record[key] !== undefined) {
        if (typeof record[key] !== 'string' || record[key].length > 300000) throw new Error(`Invalid ${key}`);
        input[key] = record[key];
      }
    }
    input.tags = Array.isArray(record.tags) ? record.tags.filter(t => typeof t === 'string').slice(0,100) : [];
    if(record.companySizeRaw!==undefined){
      if(typeof record.companySizeRaw!=='string'||record.companySizeRaw.length>128)throw new Error('Invalid companySizeRaw');
      input.companySizeRaw=record.companySizeRaw.trim();
      if(input.companySizeRaw)input.companySizeEvidence={field:'assistedCompanyMetadata',quote:input.companySizeRaw};
    }
    input.advertised = record.advertised === true;
    input.qualityFlags = ['assisted_capture'];
    if (/[\uE000-\uF8FF]/.test(input.salaryRaw || '')) input.qualityFlags.push('encoded_salary');
    return input;
  });
  // Validate the entire batch before creating the data directory or writing a receipt.
  return withPipelineLock(storePath(root), async () => {
    const state = openStore(root);
    const receipt = { schemaVersion: 1, records: inputs };
    const path = `data/china/imports/${fingerprint(receipt)}.json`;
    atomicPrivateWrite(join(root,path), `${JSON.stringify(receipt,null,2)}\n`);
    let newVersions = 0;
    const jobs = [];
    for (const input of inputs) {
      const key = jobIdentity(platform,input.url).key;
      const before = state.jobs[key]?.versions.length || 0;
      const job = recordObservation(root,state,{...input,source:{captureMethod:input.captureMethod,path}});
      newVersions += job.versions.length - before;
      jobs.push({ key, capturePath: job.versions.find(v=>v.hash===job.observations.at(-1).hash).capturePath });
    }
    saveStore(root,state);
    return { imported: inputs.length, newVersions, receiptPath: join(root,path), jobs };
  });
}
