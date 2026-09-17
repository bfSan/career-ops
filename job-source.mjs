// Immutable source indexes point to a frozen study + capture, never current store state.
import {lstatSync,readFileSync,realpathSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readStudy} from './china/market-study.mjs';
import {validateFrozenArchive,projectFrozenJob} from './china/provider-plugin.mjs';
import {atomicPrivateWrite} from './china/store.mjs';
import {withPipelineLock} from './pipeline-lock.mjs';

const REF = /^data\/job-sources\/[a-f0-9]{20}\/[a-f0-9]{20}\.json$/;
const urlHash = url => createHash('sha256').update(url).digest('hex').slice(0,20);
const refFor = (url,source) => `data/job-sources/${urlHash(url)}/${source.contentHash}.json`;

function safePath(root,ref) {
  if(typeof ref!=='string'||!REF.test(ref))throw new Error('invalid archive_ref');
  let path=realpathSync(root);
  for(const segment of ref.split('/')){
    path=join(path,segment);
    try {if(lstatSync(path).isSymbolicLink())throw new Error('unsafe source symlink');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return path;
}
function resolveSource(root,url,sourceRef) {
  if(sourceRef?.schemaVersion!==1 || !sourceRef.studyId)throw new Error('invalid sourceRef');
  const study=readStudy(root,sourceRef.studyId);
  const source=study.sources.find(s=>s.jobKey===sourceRef.jobKey&&s.contentHash===sourceRef.contentHash);
  if(!source||source.capturePath!==sourceRef.capturePath||source.observedAt!==sourceRef.observedAt)throw new Error('source version mismatch');
  const identity=validateFrozenArchive(root,source);
  const job=projectFrozenJob(source,identity,study.manifest.studyId);
  if(identity.url!==url||sourceRef.providerId!==job.sourceRef.providerId||sourceRef.platform!==job.sourceRef.platform
    ||sourceRef.availability!==job.sourceRef.availability)throw new Error('source identity mismatch');
  return {job,description:source.fields.description};
}
export async function readJobSource(root,{url,ref}) {
  const file=safePath(root,ref),stat=lstatSync(file);
  if(!stat.isFile()||stat.size>1024*1024)throw new Error('invalid source index file');
  const index=JSON.parse(readFileSync(file,'utf8'));
  if(index.schemaVersion!==1||index.url!==url||ref!==refFor(url,index.sourceRef||{}))throw new Error('source index mismatch');
  return resolveSource(root,url,index.sourceRef);
}
export async function publishJobSource(root,job) {
  const resolved=resolveSource(root,job.url,job.sourceRef);
  for(const key of ['title','company','location','description'])if(job[key]!==resolved.job[key])throw new Error(`source field mismatch: ${key}`);
  const ref=refFor(job.url,job.sourceRef),file=safePath(root,ref);
  return withPipelineLock(file,async()=>{
    safePath(root,ref);
    if(existsSync(file)){
      // A URL/content version has one reference. Keep the first published
      // observation when another study selects the identical content again.
      await readJobSource(root,{url:job.url,ref});
      return ref;
    }
    atomicPrivateWrite(file,JSON.stringify({schemaVersion:1,url:job.url,sourceRef:resolved.job.sourceRef},null,2)+'\n');
    return ref;
  });
}
export function withArchiveNote(job,ref) {
  if(!REF.test(ref))throw new Error('invalid archive_ref');
  const original=typeof job.note==='string'?job.note:'';
  const note=original.replace(/\barchive_ref=\S+/g,'').trim();
  return {...job,note:`${note?note+' ':''}archive_ref=${ref}`};
}
