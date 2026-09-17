import {readFileSync,lstatSync} from 'node:fs';import {join} from 'node:path';import {fingerprint} from './store.mjs';
const fields=new Set(['key','title','location','company','listingText']);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
// Generic list-stage policy. Target cities and role rules belong to the user's Data Root.
export function createListingScreen(policy){
 if(!exact(policy,['schemaVersion','version','rules','defaultOutcome'])||policy.schemaVersion!==1||typeof policy.version!=='string'||!policy.version||policy.defaultOutcome!=='review'||!Array.isArray(policy.rules)||policy.rules.length>100)throw new Error('Invalid collection policy');
 const ids=new Set();const rules=policy.rules.map(r=>{
  if(!exact(r,['id','outcome','all'])||typeof r.id!=='string'||!r.id||ids.has(r.id)||!['collect','exclude','review'].includes(r.outcome)||!Array.isArray(r.all)||!r.all.length||r.all.length>10)throw new Error('Invalid collection policy rule');ids.add(r.id);
  return {...r,all:r.all.map(c=>{if(!exact(c,['field','pattern'])||!fields.has(c.field)||typeof c.pattern!=='string'||!c.pattern||c.pattern.length>1000)throw new Error('Invalid collection policy condition');return{...c,re:new RegExp(c.pattern,'iu')}})};
 });
 const screen=card=>{
  for(const r of rules){const evidence=[];let matches=true;for(const c of r.all){const raw=card[c.field];const m=typeof raw==='string'?c.re.exec(raw):null;if(!m){matches=false;break;}evidence.push({field:c.field,start:m.index,end:m.index+m[0].length,quote:m[0]});}if(matches)return{outcome:r.outcome,rule:r.id,evidence,policyVersion:policy.version,listingHash:fingerprint(card)}}
  // A policy miss does not establish that the source itself lacks information.
  return{outcome:'review',rule:'no_policy_rule_matched',evidence:[],policyVersion:policy.version,listingHash:fingerprint(card)};
 };screen.policyDigest=fingerprint(policy);return screen;
}
export function loadListingScreen(root){
 const p=join(root,'data/china/collection-policy.json');let st;try{st=lstatSync(p)}catch(e){if(e.code==='ENOENT')return null;throw e}
 if(!st.isFile()||st.isSymbolicLink()||st.size>1024*1024)throw new Error('Invalid collection policy file');return createListingScreen(JSON.parse(readFileSync(p,'utf8')));
}
