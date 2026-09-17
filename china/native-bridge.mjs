import {execFile} from 'node:child_process';
import {readFileSync,mkdirSync,existsSync,renameSync,chmodSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const sourcePath=fileURLToPath(new URL('./native-bridge.m',import.meta.url));
const invoke=(file,args,input,timeout=6000)=>new Promise((resolve,reject)=>{
  const child=execFile(file,args,{timeout,maxBuffer:2*1024*1024},(error,stdout)=>{
    if(error){const e=new Error('Native Chrome bridge could not complete the operation');e.status=error.killed?'browser_timeout':'browser_bridge_error';reject(e);}
    else resolve(stdout);
  });
  child.stdin.end(input);
});
export async function buildNativeBridge(root){
  if(process.platform!=='darwin')throw new Error('Native Chrome scanning requires macOS');
  const hash=createHash('sha256').update(readFileSync(sourcePath)).digest('hex').slice(0,16);
  const directory=join(root,'data/china/native');mkdirSync(directory,{recursive:true,mode:0o700});
  const binary=join(directory,`chrome-bridge-${process.arch}-${hash}`);
  if(!existsSync(binary)){
    const temporary=`${binary}.${process.pid}.tmp`;
    try{
      await invoke('/usr/bin/clang',['-fobjc-arc','-framework','Foundation','-framework','ScriptingBridge',sourcePath,'-o',temporary],'',30000);
      chmodSync(temporary,0o700);renameSync(temporary,binary);
    }finally{rmSync(temporary,{force:true});}
  }
  return binary;
}
export async function createNativeBridge({root,session,invokeNative=invoke,startupTimeoutMs=5000,pollMs=100,onEvent=()=>{}}){
  const binary=await buildNativeBridge(root);
  let closed=false,processIdentity,ready=false,lastTabs=[];
  session.closed?.then(()=>{closed=true;});
  const ensureAlive=()=>{if(closed||session.cancelled){const e=new Error('Owned Chrome session is closed');e.status='browser_closed';throw e;}};
  const request=async args=>{
    const deadline=Date.now()+startupTimeoutMs;
    let selectionChecked=false;
    while(true){
      ensureAlive();
      const reply=JSON.parse(await invokeNative(binary,[],JSON.stringify({...args,pid:session.pid,parentPid:process.pid,processIdentity})));
      ensureAlive();
      // The native bridge checks owned PID/parent/start time before returning an identity.
      // A live child may not yet be registered for Apple Events (-600) or have a tab.
      // Wait only on its initial tab discovery: no navigation, relaunch or relaxed ownership.
      const starting=!ready&&args.command==='tabs'&&reply.processIdentity&&
        (reply.errorCode===-600||(!reply.errorCode&&Array.isArray(reply.tabs)&&reply.tabs.length===0));
      if(starting){
        processIdentity||=reply.processIdentity;
        if(Date.now()>=deadline){const e=new Error('Owned Chrome did not expose its initial tab in time');e.status='browser_startup_timeout';throw e;}
        await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(0,deadline-Date.now()))));
        continue;
      }
      // The native helper reports this stage only before executing JavaScript.
      // Confirm the exact existing PID/window/tab/URL once; do not replay an
      // uncertain execution, navigate, rebind a tab, or reopen a browser.
      if(!selectionChecked&&ready&&args.command==='evaluate'&&reply.errorCode===-1728&&reply.errorStage==='selected_tab_missing'&&reply.processIdentity===processIdentity){
        selectionChecked=true;
        const expected=lastTabs.find(t=>t.windowId===args.windowId&&t.tabId===args.tabId);
        const probe=JSON.parse(await invokeNative(binary,[],JSON.stringify({command:'tabs',pid:session.pid,parentPid:process.pid,processIdentity})));
        ensureAlive();
        const same=expected&&!probe.errorCode&&probe.processIdentity===processIdentity&&probe.tabs?.length===1&&probe.tabs[0].windowId===expected.windowId&&probe.tabs[0].tabId===expected.tabId&&probe.tabs[0].url===expected.url;
        onEvent({event:'native_selection_check',sameTarget:!!same,tabCount:probe.tabs?.length??null});
        if(same)continue;
      }
      if(reply.errorCode){
        const e=new Error(reply.errorCode===12?'Chrome requires View → Developer → Allow JavaScript from Apple Events':reply.errorCode===-1743?'macOS has not allowed this process to automate Chrome':'Native Chrome target is unavailable');
        e.status=reply.errorCode===12?'browser_permission_required':reply.errorCode===-1743?'automation_permission_required':'browser_closed';e.bridgeErrorCode=reply.errorCode;e.bridgeErrorStage=reply.errorStage??null;throw e;
      }
      processIdentity||=reply.processIdentity;
      if(args.command==='tabs'){lastTabs=reply.tabs||[];if(lastTabs.length)ready=true;}
      return reply;
    }
  };
  return {
    navigate:async(tab,url)=>{await request({command:'navigate',...tab,url});},
    tabs:async()=>(await request({command:'tabs'})).tabs,
    evaluate:async(tab,source)=>JSON.parse((await request({command:'evaluate',...tab,source})).result),
  };
}
