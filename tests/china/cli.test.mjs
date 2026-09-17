import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const entry=fileURLToPath(new URL('../../china-jobs.mjs',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[entry,...args],{encoding:'utf8',timeout:10000});
test('scan rejects malformed policy before initializing any browser profile',()=>{
 const root=mkdtempSync(join(tmpdir(),'china-cli-policy-'));
 try{
  mkdirSync(join(root,'data/china'),{recursive:true});writeFileSync(join(root,'data/china/collection-policy.json'),'{}');
  const result=spawnSync(process.execPath,[entry,'scan','--root',root,'--platform','liepin','--query','AI','--browser-driver','playwright','--channel','chromium','--headless'],{encoding:'utf8',timeout:10000,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:join(root,'absent-browser-binaries')}});
  assert.equal(result.status,1);assert.match(result.stderr,/Invalid collection policy/);
  assert.equal(existsSync(join(root,'data/china/browser')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('CLI help works without profile/CV/browser and list is read-only in an external root',()=>{
  const root=mkdtempSync(join(tmpdir(),'china-cli-test-'));
  try {
    const help=run('--help');assert.equal(help.status,0);assert.match(help.stdout,/login/);assert.match(help.stdout,/--resume/);assert.match(help.stdout,/--browser-driver/);
    const list=run('list','--root',root);assert.equal(list.status,0,list.stderr);assert.deepEqual(JSON.parse(list.stdout).jobs,[]);
    assert.equal(existsSync(join(root,'data')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('invalid native driver combinations fail before launching or writing data',()=>{
 const root=mkdtempSync(join(tmpdir(),'china-cli-native-'));
 try{
  for(const extra of [['--browser-driver','other'],['--browser-driver','native','--headless'],['--browser-driver','native','--channel','chromium']]){
   const result=run('scan','--root',root,'--platform','boss','--query','Agent',...extra);
   assert.equal(result.status,1);assert.match(result.stderr,/error/);assert.equal(existsSync(join(root,'data')),false);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('invalid args fail before launching a browser or writing data',()=>{
  for(const args of [['scan','--platform','other','--query','Agent'],['scan','--platform','boss','--query','Agent','--limit','0'],['scan','--platform','boss','--query','Agent','--pages','2oops'],['scan','--platform','boss','--query','Agent','--search-url','https://www.zhipin.com/web/geek/job'],['scan','--platform','boss','--unknown'],['queue','--platform','other'],['scan','--platform','boss']]) {
    const result=run(...args);assert.equal(result.status,1,JSON.stringify(args));assert.match(result.stderr,/error/);
  }
});
test('setup-providers needs no platform and writes plugins only under the code root',()=>{
  const root=mkdtempSync(join(tmpdir(),'china-cli-providers-'));
  try {
    const result=run('setup-providers','--code-root',root); assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{created:['career-boss','career-liepin','career-linkedin'],reused:[],conflict:[]});
    assert.equal(existsSync(join(root,'plugins.local/career-boss/manifest.json')),true);
    assert.equal(existsSync(join(root,'data')),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('network scan budget is capped before driver selection',()=>{
 for(const [flag,value,error] of [['--limit','51',/limit/],['--pages','21',/pages/],['--delay-ms','5000',/delay-ms/]]){
  const result=run('scan','--platform','boss','--query','AI',flag,value,'--browser-driver','invalid');
  assert.equal(result.status,1);assert.match(result.stderr,error);
 }
});

test('explicit larger scan budgets and LinkedIn pass validation but retain strict driver selection',()=>{
 for(const platform of ['boss','liepin','linkedin']){
  const result=run('scan','--platform',platform,'--query','AI','--limit','6','--pages','2','--browser-driver','invalid');
  assert.equal(result.status,1);assert.match(result.stderr,/browser-driver must/);
 }
});
