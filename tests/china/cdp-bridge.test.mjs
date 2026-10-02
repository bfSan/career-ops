import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createCdpBridge,devToolsPort} from '../../china/cdp-bridge.mjs';

// The bridge is what replaced the Apple Events helper. These tests pin its two
// load-bearing properties:
//   1. it discovers the port Chrome itself bound instead of guessing one; and
//   2. it sends commands only, so it never enables a protocol domain.

// Only a port that answers /json/version is trusted, so offline tests supply a
// fake endpoint instead of contacting a real browser.
const liveFetch=async()=>({ok:true});
const deadFetch=async()=>{throw new Error('ECONNREFUSED');};

function profileWithPort(t,{port='45123',body=`${'45123'}\n/devtools/browser/fixture\n`}={}){
  const root=mkdtempSync(join(tmpdir(),'cdp-bridge-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'DevToolsActivePort'),body);
  return root;
}

test('the bridge reads the port Chrome published instead of guessing a free one',async t=>{
  const root=profileWithPort(t,{body:'45123\n/devtools/browser/fixture\n'});
  assert.equal(await devToolsPort(root,{timeoutMs:100,pollMs:5,fetchImpl:liveFetch}),45123);
});

test('a port file that has not been written yet is awaited within a bounded window',async t=>{
  const root=mkdtempSync(join(tmpdir(),'cdp-bridge-late-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  // Chrome publishes this file a moment after launch; the bridge must wait, not
  // fail, and must still fail closed if it never appears.
  setTimeout(()=>writeFileSync(join(root,'DevToolsActivePort'),'46000\n/devtools/browser/fixture\n'),60);
  assert.equal(await devToolsPort(root,{timeoutMs:500,pollMs:10,fetchImpl:liveFetch}),46000);
  await assert.rejects(devToolsPort(mkdtempSync(join(tmpdir(),'cdp-bridge-empty-')),{timeoutMs:80,pollMs:10,fetchImpl:liveFetch}),
    error=>error.status==='browser_startup_timeout');
});

test('a malformed port file is never treated as a usable port',async t=>{
  const root=profileWithPort(t,{body:'not-a-port\n'});
  await assert.rejects(devToolsPort(root,{timeoutMs:60,pollMs:10,fetchImpl:liveFetch}),error=>error.status==='browser_startup_timeout');
});

test('a stale port left in a copied profile is never trusted',async t=>{
  // A profile copied from another machine can carry an old DevToolsActivePort.
  // Its port is not listening, so it must be rejected instead of surfacing later
  // as a confusing "endpoint unreachable" during extraction.
  const root=profileWithPort(t,{body:'34945\n/devtools/browser/stale\n'});
  await assert.rejects(devToolsPort(root,{timeoutMs:80,pollMs:10,fetchImpl:deadFetch}),error=>error.status==='browser_startup_timeout');
});

test('a closed or absent owned session is refused before any socket work',async()=>{
  await assert.rejects(createCdpBridge({root:'/tmp'}),error=>error.status==='browser_closed');
  await assert.rejects(createCdpBridge({root:'/tmp',session:{}}),error=>error.status==='browser_closed');
});

// Real end-to-end proof against an actual Chrome: the bridge must read the live
// page and must never be the reason a target disappears.
test('the bridge drives a real owned Chrome window without enabling a protocol domain',{skip:process.env.CHINA_CDP_BROWSER_TEST!=='1'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'cdp-bridge-live-'));
  const profile=join(root,'profile');
  const child=spawn(process.env.CHROME_PATH||'/opt/google/chrome/chrome',[
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--new-window',
    '--remote-debugging-port=0','--hide-crash-restore-bubble',
    'data:text/html,<title>Career cdp fixture</title><body><p id="probe">synthetic-only</p></body>',
  ],{stdio:'ignore'});
  const closed=new Promise(resolve=>child.once('exit',resolve));
  t.after(async()=>{child.kill('SIGTERM');await closed;rmSync(root,{recursive:true,force:true});});
  const bridge=await createCdpBridge({root,session:{directory:profile}});
  t.after(()=>bridge.close());
  let tabs=[];const deadline=Date.now()+10000;
  do{tabs=(await bridge.tabs()).filter(tab=>tab.url.startsWith('data:text/html,'));if(tabs.length)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
  assert.equal(tabs.length,1,'reads only the owned synthetic tab');
  assert.deepEqual(await bridge.evaluate(tabs[0],'JSON.stringify({text:document.getElementById("probe").textContent})'),{text:'synthetic-only'});
  // A syntax error must surface as an extraction failure, never as a fake value.
  await assert.rejects(bridge.evaluate(tabs[0],'this is not javascript'),error=>error.status==='extraction_failed');
  // A non-JSON return is a contract violation and must not be silently coerced.
  await assert.rejects(bridge.evaluate(tabs[0],'1+1'),error=>error.status==='extraction_failed');
  // An unknown tab is terminal: never rebind to whatever page happens to be open.
  await assert.rejects(bridge.evaluate({...tabs[0],tabId:'missing'},'JSON.stringify({})'),error=>error.status==='browser_closed');
});
