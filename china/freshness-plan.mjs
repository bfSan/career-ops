#!/usr/bin/env node
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {getCareerOpsRoot} from '../path-resolver.mjs';

const root=getCareerOpsRoot();
const CITIES=['上海','杭州','南京','福州'];
const PLATFORMS=['liepin','boss'];
const MAX_JOBS_PER_BATCH=2;
const MIN_INTERVAL_MS=15000;
const KEYWORDS='AI Agent';

function args(argv){const out={_:[]};for(let i=0;i<argv.length;i++){const x=argv[i];if(x.startsWith('--')){const [k,v]=x.slice(2).split('=',2);out[k]=v??argv[++i]??true;}else out._.push(x);}return out;}
function usage(){console.log(`四城双平台可见扩展保鲜计划（不访问站点、不控制浏览器）

用法：
  node china/freshness-plan.mjs preview
  node china/freshness-plan.mjs build --platform liepin|boss --city 上海
  node china/freshness-plan.mjs import --platform liepin|boss --file /absolute/export.json

约束：每城每平台最多2条；两条至少15秒；BOSS/猎聘串行；验证立即停止。
`);}
function loadStore(){const p=join(root,'data','china','store.json');return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{jobs:{},runs:[]};}
function cityOf(location){return CITIES.find(c=>String(location||'').includes(c))||null;}
function ageDays(iso){const t=Date.parse(iso||'');return Number.isFinite(t)?Math.max(0,(Date.now()-t)/86400000):Infinity;}
function summary(){const s=loadStore();const rows=[];for(const city of CITIES)for(const platform of PLATFORMS){const jobs=Object.values(s.jobs||{}).filter(j=>j.platform===platform&&cityOf(j.latest?.location)===city&&j.latest?.description);const latest=jobs.map(j=>j.latest?.observedAt||j.lastSeenAt).sort().at(-1)||null;rows.push({city,platform,jobs:jobs.length,lastObservedAt:latest,ageDays:Number.isFinite(ageDays(latest))?Number(ageDays(latest).toFixed(1)):null});}return rows;}
function preview(){console.log(JSON.stringify({schemaVersion:1,keyword:KEYWORDS,cities:CITIES,platforms:PLATFORMS,maxJobsPerBatch:MAX_JOBS_PER_BATCH,minIntervalMs:MIN_INTERVAL_MS,serial:true,stopOn:['challenge','login_required','navigation_changed','blank_page','incomplete_jd'],tasks:summary().map((x,i)=>({...x,order:i+1,action:`构建 ${x.platform} 的 ${x.city} 目标版本；普通Chrome通过可见输入框搜索并点击城市控件；完成后显式导入导出JSON`}))},null,2));}
function validPlatform(x){if(!PLATFORMS.includes(x))throw new Error(`platform 必须是 ${PLATFORMS.join('|')}`);return x;}
function validCity(x){if(!CITIES.includes(x))throw new Error(`city 必须是 ${CITIES.join('、')}`);return x;}
function build(a){const platform=validPlatform(a.platform),city=validCity(a.city);const script=platform==='liepin'?'china/build-liepin-extension.mjs':'china/build-extension.mjs';const r=spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,CAREER_OPS_CITY:city},stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);console.log(JSON.stringify({ok:true,platform,city,keyword:KEYWORDS,maxJobsPerBatch:MAX_JOBS_PER_BATCH,minIntervalMs:MIN_INTERVAL_MS,next:'在对应普通Chrome扩展管理页刷新加载；不要手动拼接结果URL'},null,2));}
function importBatch(a){const platform=validPlatform(a.platform);if(!a.file)throw new Error('--file 必填');const file=String(a.file);const r=spawnSync(process.execPath,['china-jobs.mjs','import','--platform',platform,'--file',file],{cwd:root,stdio:'inherit'});process.exit(r.status??1);}
const a=args(process.argv.slice(2));const command=a._[0]||'preview';try{if(command==='preview')preview();else if(command==='build')build(a);else if(command==='import')importBatch(a);else {usage();process.exitCode=1;}}catch(e){console.error(`freshness-plan: ${e.message}`);process.exitCode=1;}
