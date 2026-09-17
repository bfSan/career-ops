import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import * as login from '../../china/login.mjs';
import {openBrowser} from '../../china/browser.mjs';

// Real child process boundary: records received arguments and flushes a marker
// on SIGTERM. It neither launches Chrome nor makes network requests.
function fixture(t,body) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'china-native-login-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const executablePath=join(root,'browser');
  writeFileSync(executablePath,`#!${process.execPath}\nconst fs=require('node:fs');\nconst path=require('node:path');\nconst root=__dirname;\n${body || "fs.writeFileSync(path.join(root,'args.json'),JSON.stringify(process.argv.slice(2)));process.on('SIGTERM',()=>{fs.writeFileSync(path.join(root,'flushed'),'yes');process.exit(0);});setInterval(()=>{},1000);"}`,{mode:0o700});
  return {root,platform:'boss',url:'https://www.zhipin.com/web/user/',executablePath};
}

test('native BOSS login opens the collector profile without a debugger and waits for graceful close',async t=>{
  assert.equal(typeof login.openNativeLogin,'function');
  const options=fixture(t);
  const session=await login.openNativeLogin(options);
  t.after(()=>session.close());
  const args=JSON.parse(readFileSync(join(options.root,'args.json'),'utf8'));
  assert.ok(args.includes(`--user-data-dir=${join(options.root,'data/china/browser/boss')}`));
  assert.equal(args.at(-1),options.url);
  assert.ok(!args.some(a=>/debugging|automation|disable-blink|headless/.test(a)));
  await session.close();
  assert.equal(readFileSync(join(options.root,'flushed'),'utf8'),'yes');
  await session.close();
  assert.equal((await session.closed).code,0);
});

test('native login and scanner cannot concurrently use the same profile',async t=>{
  assert.equal(typeof login.openNativeLogin,'function');
  const options=fixture(t);const session=await login.openNativeLogin(options);
  t.after(()=>session.close());
  await assert.rejects(login.openNativeLogin(options),/profile.*in use/i);
  // Must reject before launching a real browser.
  await assert.rejects(openBrowser({root:options.root,platform:'boss',headless:true}),/profile.*in use/i);
  await session.close();
  const next=await login.openNativeLogin(options);await next.close();
});

test('an externally owned Chrome profile is refused without touching its process',async t=>{
  assert.equal(typeof login.openNativeLogin,'function');
  const options=fixture(t);const session=await login.openNativeLogin(options);await session.close();
  symlinkSync(`${hostname()}-${process.pid}`,join(options.root,'data/china/browser/boss/SingletonLock'));
  await assert.rejects(login.openNativeLogin(options),/profile.*in use/i);
  assert.ok(existsSync(join(options.root,'data/china/browser/boss')));
  process.kill(process.pid,0);
});

test('startup failure releases the lease and an early successful exit is not treated as an owned window',async t=>{
  assert.equal(typeof login.openNativeLogin,'function');
  const options=fixture(t,'process.exit(0);');
  await assert.rejects(login.openNativeLogin(options),/exited|start/i);
  await assert.rejects(login.openNativeLogin({...options,executablePath:join(options.root,'missing')}),/ENOENT|executable/i);
  writeFileSync(options.executablePath,`#!${process.execPath}\nsetInterval(()=>{},1000);`,{mode:0o700});
  const session=await login.openNativeLogin(options);await session.close();
});

test('confirmation closes the native process before returning an explicitly unverified session',async t=>{
  assert.equal(typeof login.openNativeLogin,'function');
  assert.equal(typeof login.waitForNativeLogin,'function');
  const options=fixture(t);const session=await login.openNativeLogin(options);
  t.after(()=>session.close());
  const input=new PassThrough(),output=new PassThrough();
  const pending=login.waitForNativeLogin({session,input,output,timeoutMs:2000});
  input.write('\n');
  assert.equal((await pending).status,'session_unverified');
  assert.ok(existsSync(join(options.root,'flushed')));
});

test('native login timeout and input cancellation close only the owned process and never report success',async t=>{
  assert.equal(typeof login.openNativeLogin,'function');
  assert.equal(typeof login.waitForNativeLogin,'function');
  const options=fixture(t);
  for(const action of ['timeout','cancel']) {
    const session=await login.openNativeLogin(options);t.after(()=>session.close());
    const input=new PassThrough(),output=new PassThrough();
    const pending=login.waitForNativeLogin({session,input,output,timeoutMs:100});
    if(action==='cancel') input.end();
    assert.equal((await pending).status,action==='timeout'?'login_timeout':'cancelled');
    assert.ok(existsSync(join(options.root,'flushed')));
  }
});

test('confirmation followed by an abnormal browser exit does not claim the profile was saved',async t=>{
  const options=fixture(t,"process.on('SIGTERM',()=>process.exit(1));setInterval(()=>{},1000);");
  const session=await login.openNativeLogin(options);t.after(()=>session.close());
  const input=new PassThrough(),output=new PassThrough();
  const pending=login.waitForNativeLogin({session,input,output,timeoutMs:2000});
  input.write('\n');
  assert.equal((await pending).status,'browser_exit_error');
});

async function untilFile(path) {
  const deadline=Date.now()+5000;
  while(!existsSync(path)) {
    assert.ok(Date.now()<deadline,`Timed out waiting for ${path}`);
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}

test('Ctrl+C during startup or shutdown still waits for the owned child to exit',async t=>{
  for(const phase of ['startup','shutdown']) {
    const options=fixture(t,"fs.writeFileSync(path.join(root,'started'),String(process.pid));process.on('SIGTERM',()=>{fs.writeFileSync(path.join(root,'closing'),'yes');setTimeout(()=>{fs.writeFileSync(path.join(root,'flushed'),'yes');process.exit(0);},300);});setInterval(()=>{},1000);");
    const moduleUrl=new URL('../../china/login.mjs',import.meta.url).href;
    const worker=spawn(process.execPath,['--input-type=module','-e',`
      import {openNativeLogin,waitForNativeLogin} from ${JSON.stringify(moduleUrl)};
      import {PassThrough} from 'node:stream';
      try {
        const session=await openNativeLogin(${JSON.stringify({...options,startupMs:phase==='startup'?2000:1000})});
        const input=new PassThrough();
        const pending=waitForNativeLogin({session,input,output:new PassThrough()});
        input.write('\\n');
        await pending;
      }catch {process.exitCode=2;}
    `],{stdio:'ignore'});
    const exited=new Promise(resolve=>worker.once('exit',(code,signal)=>resolve({code,signal})));
    let browserPid;
    t.after(()=>{if(browserPid) {try {process.kill(browserPid,'SIGTERM');}catch {}}worker.kill();});
    await untilFile(join(options.root,phase==='startup'?'started':'closing'));
    browserPid=Number(readFileSync(join(options.root,'started'),'utf8'));
    worker.kill('SIGINT');
    const result=await exited;
    assert.equal(result.signal,null);
    assert.ok(existsSync(join(options.root,'flushed')));
  }
});
