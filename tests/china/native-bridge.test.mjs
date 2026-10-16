import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNativeBridge} from '../../china/native-bridge.mjs';

// Explicit opt-in: this integration test briefly opens a synthetic native
// window. Keep default/headless tests from interrupting a user-operated login.
test('native bridge targets only its child PID and respects Chrome JavaScript permission', {skip:process.platform!=='darwin'||process.env.CHINA_NATIVE_BROWSER_TEST!=='1'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'china-native-bridge-'));
  const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
    `--user-data-dir=${join(root,'profile')}`,'--no-first-run','--no-default-browser-check','--new-window',
    'data:text/html,<title>Career native fixture</title><body>synthetic-only</body>',
  ],{stdio:'ignore'});
  const closed=new Promise(resolve=>child.once('exit',resolve));
  t.after(async()=>{child.kill('SIGTERM');await closed;rmSync(root,{recursive:true,force:true});});
  const bridge=await createNativeBridge({root,session:{pid:child.pid}});
  let tabs=[];const deadline=Date.now()+5000;
  do{tabs=await bridge.tabs();if(tabs.length)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
  assert.equal(tabs.length,1);
  assert.ok(tabs[0].url.startsWith('data:text/html,'),'never reads another profile or an ordinary Chrome tab');
  await bridge.navigate(tabs[0],'about:blank');
  assert.equal((await bridge.tabs())[0].url,'about:blank');
  await assert.rejects(bridge.navigate({...tabs[0],tabId:'missing'},'about:blank'),error=>error.status==='browser_closed');
  await assert.rejects(bridge.evaluate(tabs[0],'JSON.stringify({title:document.title})'),error=>error.status==='browser_permission_required');
  await assert.rejects(bridge.evaluate({...tabs[0],tabId:'missing'},'JSON.stringify({title:document.title})'),error=>error.status==='browser_closed');
});
