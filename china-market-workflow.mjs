#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {getCareerOpsRoot} from './path-resolver.mjs';
import {isMainModule} from './lib/is-main-module.mjs';
import {readJsonLimited} from './china-market.mjs';
import {readStudy} from './china/market-study.mjs';
import {reconcileWorkflow,publishMarketRelease} from './china/market-release.mjs';

const HELP=`Offline market workflow (no browser or automatic semantic review).
reconcile --pool FILE --candidates FILE --state FILE [--reviews FILE] [--refresh-key KEY ...]
publish --pool FILE --study ID --file ANALYSIS --configuration-hash HASH --release ID [--classifications FILE] [--workflow FILE]
Both: --root PATH. Paths are relative to Data Root unless absolute.
After a market scan, reconcile persists acquisition/review and pending-scope tasks.
Publish requires all selected JD dimensions reviewed and source/version evidence valid.
The atomic current report pointer is reports/china-market/current.
`;
export async function main(args=process.argv.slice(2)){
 const strings=['root','pool','candidates','state','reviews','study','file','configuration-hash','release','classifications','workflow'];
 const {values:v,positionals}=parseArgs({args,allowPositionals:true,options:{...Object.fromEntries(strings.map(k=>[k,{type:'string'}])),help:{type:'boolean'},'refresh-key':{type:'string',multiple:true}}});
 if(v.help){console.log(HELP);return 0;}
 const [command]=positionals;if(positionals.length!==1||!['reconcile','publish'].includes(command))throw new Error('Choose reconcile or publish');
 const required=command==='reconcile'?['pool','candidates','state']:['pool','study','file','configuration-hash','release'];
 const allowed=new Set(['root',...required,...(command==='reconcile'?['reviews','refresh-key']:['classifications','workflow'])]);
 if(required.some(k=>!v[k])||Object.keys(v).some(k=>!allowed.has(k)))throw new Error('Missing or incompatible workflow options; use --help');
 const root=v.root?resolve(v.root):getCareerOpsRoot(),read=file=>readJsonLimited(resolve(root,file)),pool=read(v.pool);
 if(command==='reconcile'){
  const r=await reconcileWorkflow(root,{pool,candidateFile:v.candidates,stateFile:v.state,reviews:v.reviews?read(v.reviews).records:[],refreshKeys:v['refresh-key']||[]});
  console.log(JSON.stringify({stateFile:resolve(root,v.state),summary:r.summary,pendingScope:r.scopeTasks.length,pendingAnalysis:r.analysisTasks.filter(t=>t.state==='pending_analysis').length,analysisErrors:r.analysisErrors.length}));return 0;
 }
 const r=await publishMarketRelease(root,{pool,study:readStudy(root,v.study),bundle:read(v.file),configurationHash:v['configuration-hash'],releaseId:v.release,classifications:v.classifications?read(v.classifications).records:[],candidates:v.workflow?read(v.workflow):null});
 console.log(JSON.stringify(r));return 0;
}
if(isMainModule(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
