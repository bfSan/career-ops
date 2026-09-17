import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {openBrowser as openProfileBrowser} from '../../china/browser.mjs';

const channel=process.env.CHINA_TEST_CHANNEL||'chrome';
const openBrowser=options=>openProfileBrowser({channel,...options});

test('macOS scanner reads a synthetic cookie saved using the native Chrome keychain', {skip:process.platform!=='darwin'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'china-keychain-'));
  let writer,reader;
  try {
    writer=await chromium.launchPersistentContext(join(root,'data/china/browser/boss'),{
      channel:'chrome',headless:true,
      ignoreDefaultArgs:['--use-mock-keychain','--password-store=basic'],
    });
    // Only a synthetic cookie in this temporary profile. No website navigation,
    // account access, copying of real cookies, or direct keychain API calls.
    await writer.addCookies([{name:'career_ops_persistence_test',value:'synthetic-only',domain:'career-ops.invalid',path:'/',expires:Math.floor(Date.now()/1000)+3600}]);
    await writer.close();writer=null;
    reader=await openBrowser({root,platform:'boss',channel:'chrome',headless:true});
    const cookies=await reader.cookies('https://career-ops.invalid/');
    assert.equal(cookies.find(cookie=>cookie.name==='career_ops_persistence_test')?.value,'synthetic-only');
  }finally {
    await writer?.close();await reader?.close();
    rmSync(root,{recursive:true,force:true});
  }
});

const fixtures=[
  {name:'career_ops_persistent',value:'synthetic-persistent',domain:'.zhipin.com',path:'/',expires:Math.floor(Date.now()/1000)+3600},
  {name:'career_ops_session',value:'synthetic-session',domain:'.zhipin.com',path:'/'},
];
const cachePath=root=>join(root,'data/china/browser/boss/career-ops-session-cookies.json');
test('BOSS remembers session cookies across normal closes without restoring any old website tabs',async t=>{
  const root=mkdtempSync(join(tmpdir(),'china-session-cookie-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let context=await openBrowser({root,platform:'boss',headless:true});
  t.after(()=>context?.close());
  await context.addCookies(fixtures);await context.close();context=null;
  context=await openBrowser({root,platform:'boss',headless:true});
  const cookies=await context.cookies('https://www.zhipin.com/');
  assert.equal(cookies.find(c=>c.name==='career_ops_session')?.value,'synthetic-session');
  assert.equal(cookies.find(c=>c.name==='career_ops_persistent')?.value,'synthetic-persistent');
  assert.deepEqual(context.pages().map(p=>p.url()),['about:blank']);
  await context.close();context=null;
  const snapshot=JSON.parse(readFileSync(cachePath(root),'utf8'));
  assert.deepEqual(snapshot.cookies.map(c=>c.name),['career_ops_session'],'persistent login credentials remain in Chrome encrypted storage');
  assert.equal(statSync(cachePath(root)).mode&0o777,0o600);
});

test('changed native Chrome credentials invalidate an earlier session-cookie snapshot',async t=>{
  const root=mkdtempSync(join(tmpdir(),'china-session-changed-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let context=await openBrowser({root,platform:'boss',headless:true});t.after(()=>context?.close());
  await context.addCookies(fixtures);await context.close();context=null;
  context=await chromium.launchPersistentContext(join(root,'data/china/browser/boss'),{...(channel==='chromium'?{}:{channel}),headless:true,ignoreDefaultArgs:['--use-mock-keychain','--password-store=basic']});
  await context.addCookies([{...fixtures[0],value:'synthetic-new-login'}]);await context.close();context=null;
  context=await openBrowser({root,platform:'boss',headless:true});
  const cookies=await context.cookies('https://www.zhipin.com/');
  assert.equal(cookies.find(c=>c.name==='career_ops_persistent')?.value,'synthetic-new-login');
  assert.equal(cookies.find(c=>c.name==='career_ops_session'),undefined);
});

test('an expired or malformed session-cookie snapshot is ignored instead of replayed',async t=>{
  for(const kind of ['expired','malformed','wrong_host']) {
    const root=mkdtempSync(join(tmpdir(),'china-session-invalid-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
    let context=await openBrowser({root,platform:'boss',headless:true});t.after(()=>context?.close());
    await context.addCookies(fixtures);await context.close();context=null;
    const snapshot=JSON.parse(readFileSync(cachePath(root),'utf8'));
    if(kind==='expired')snapshot.savedAt='2000-01-01T00:00:00.000Z';
    if(kind==='wrong_host')snapshot.cookies[0].domain='.unrelated.invalid';
    writeFileSync(cachePath(root),kind==='malformed'?'invalid-json':JSON.stringify(snapshot));
    context=await openBrowser({root,platform:'boss',headless:true});
    const cookies=await context.cookies();
    assert.equal(cookies.find(c=>c.name==='career_ops_session'),undefined,kind);
    assert.equal(cookies.find(c=>c.name==='career_ops_persistent')?.value,'synthetic-persistent');
    await context.close();context=null;
  }
});

test('clearing cookies during shutdown cannot resurrect the old session snapshot',async t=>{
  const root=mkdtempSync(join(tmpdir(),'china-session-close-race-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let context=await openBrowser({root,platform:'boss',headless:true});t.after(()=>context?.close());
  await context.addCookies(fixtures);
  const read=context.cookies.bind(context);
  context.cookies=async()=>{
    const snapshot=await read();
    await context.clearCookies();
    return snapshot;
  };
  await context.close();context=null;
  context=await openBrowser({root,platform:'boss',headless:true});
  assert.equal((await context.cookies()).find(c=>c.name==='career_ops_session'),undefined);
});

test('BOSS closes its pages before sampling session cookies at shutdown',async t=>{
  const root=mkdtempSync(join(tmpdir(),'china-session-quiesce-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let context=await openBrowser({root,platform:'boss',headless:true});t.after(()=>context?.close());
  await context.addCookies(fixtures);
  let sampledWithPages;
  const read=context.cookies.bind(context);
  context.cookies=async()=>{sampledWithPages=context.pages().length;return read();};
  await context.close();context=null;
  assert.equal(sampledWithPages,0);
  context=await openBrowser({root,platform:'boss',headless:true});
  assert.equal((await context.cookies()).find(c=>c.name==='career_ops_session')?.value,'synthetic-session');
});

test('an in-flight page keepalive request makes the session snapshot ineligible',async t=>{
  const root=mkdtempSync(join(tmpdir(),'china-session-keepalive-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let context=await openBrowser({root,platform:'boss',headless:true});t.after(()=>context?.close());
  await context.addCookies(fixtures);
  let unblock;
  const held=new Promise(resolve=>{unblock=resolve;});
  t.after(unblock);
  await context.route('**/*',async route=>{
    if(route.request().url().endsWith('/hold'))await held;
    else await route.fulfill({contentType:'text/html',body:'<html><body>Synthetic local fixture</body></html>'});
  });
  const page=context.pages()[0];
  await page.goto('https://www.zhipin.com/');
  const requested=page.waitForRequest('https://www.zhipin.com/hold');
  await page.evaluate(()=>{void fetch('/hold',{keepalive:true}).catch(()=>{});});
  await requested;
  await context.close();context=null;
  context=await openBrowser({root,platform:'boss',headless:true});
  assert.equal((await context.cookies()).find(c=>c.name==='career_ops_session'),undefined);
  assert.equal((await context.cookies()).find(c=>c.name==='career_ops_persistent')?.value,'synthetic-persistent');
});
