import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {recordObservation} from '../../china/store.mjs';
const description='负责AI平台工程开发、模型评测与上线，具备扎实的软件开发经验和系统设计能力，能够独立分析生产故障并推进改进。';
test('a fresh complete capture cannot retain a stale company size; failures preserve the good version',t=>{
 const root=mkdtempSync(join(tmpdir(),'size-continuity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const state={schemaVersion:1,jobs:{},runs:[]},base={platform:'boss',url:'https://www.zhipin.com/job_detail/size.html',title:'AI工程师',company:'甲公司',status:'ok',description};
 const j=recordObservation(root,state,{...base,observedAt:'2026-09-10T00:00:00Z',companySizeRaw:'100-499人',companySizeEvidence:{field:'companyMetadata',quote:'100-499人'}});
 recordObservation(root,state,{...base,status:'challenge',observedAt:'2026-09-11T00:00:00Z'});
 assert.equal(j.latest.companySizeRaw,'100-499人');assert.equal(j.latestListing.companySizeRaw,'100-499人');
 recordObservation(root,state,{...base,company:'乙公司',observedAt:'2026-09-12T00:00:00Z'});
 assert.equal(j.latest.companySizeRaw,undefined);assert.equal(j.latestListing.companySizeRaw,undefined);assert.equal(j.latestListing.companySizeEvidence,undefined);
});
