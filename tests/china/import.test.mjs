import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importJobs} from '../../china/import.mjs';
import {openStore} from '../../china/store.mjs';

const record={url:'https://www.zhipin.com/job_detail/a123.html',title:'Agent平台工程师',company:'测试公司',description:'负责生产级 Agent 开发，构建工具执行、状态管理、评测与观测系统。要求能够解释系统架构决策与故障恢复流程。',captureMethod:'browser_accessibility',observedAt:'2026-09-10T01:00:00.000Z',complete:true};
const temp=()=>mkdtempSync(join(tmpdir(),'china-import-test-'));
test('assisted visible capture archives provenance, deduplicates and never queues automatically',async()=>{
  const root=temp();try{
    assert.equal((await importJobs(root,{platform:'boss',records:[record]})).newVersions,1);
    assert.equal((await importJobs(root,{platform:'boss',records:[record]})).newVersions,0);
    const job=openStore(root).jobs['boss:a123'];
    assert.equal(job.latest.description,record.description);assert.equal(job.versions.length,1);
    assert.equal(job.lastAttempt.source.captureMethod,'browser_accessibility');
    assert.equal(JSON.parse(readFileSync(join(root,job.lastAttempt.source.path),'utf8')).records[0].url,record.url);
    assert.equal(existsSync(join(root,'data/pipeline.md')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('incomplete, gated or malformed imports fail the whole batch before data writes',async()=>{
  for(const patch of [{complete:false},{description:record.description+'登录查看完整内容'},{url:'https://evil.test/job_detail/a123.html'},{captureMethod:'guessed'},{observedAt:'invalid'}]) {
    const root=temp();try{
      await assert.rejects(importJobs(root,{platform:'boss',records:[record,{...record,...patch}]}));
      assert.equal(existsSync(join(root,'data')),false);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});
test('CLI imports visible captures from JSON without opening any browser',()=>{
  const root=temp();try{
    const file=join(root,'input.json');writeFileSync(file,JSON.stringify([record]));
    const cli=fileURLToPath(new URL('../../china-jobs.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[cli,'import','--platform','boss','--file',file,'--root',root],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).imported,1);
    assert.equal(existsSync(join(root,'data/china/browser')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('explicit expired and verification notices reject the entire import batch',async()=>{
 for(const sourceText of ['该职位已过期','请进行安全验证','该职位已不存在','请您先通过人机验证']) {
  const root=temp();try{
   await assert.rejects(importJobs(root,{platform:'boss',records:[record,{...record,sourceText}]}));
   assert.equal(existsSync(join(root,'data')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});

test('explicit company-size input is retained with assisted source provenance',async()=>{
 const root=temp();try{
  await importJobs(root,{platform:'boss',records:[{...record,companySizeRaw:'100-499人'}]});
  const j=openStore(root).jobs['boss:a123'];assert.equal(j.latest.companySizeRaw,'100-499人');
  assert.equal(j.latest.companySizeEvidence.field,'assistedCompanyMetadata');assert.equal(j.latest.companySizeEvidence.quote,'100-499人');
  assert.equal(JSON.parse(readFileSync(join(root,j.lastAttempt.source.path))).records[0].companySizeRaw,'100-499人');
 }finally{rmSync(root,{recursive:true,force:true});}
});
