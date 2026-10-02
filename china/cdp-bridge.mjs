import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// ---------------------------------------------------------------------------
// Minimal CDP bridge for the owned Chrome window.
//
// Measured 2026-10-02 against BOSS with a logged-in profile:
//   * Playwright / puppeteer  -> page wiped to about:blank
//   * a bare Runtime.evaluate -> 30 cards + full JD, stable for 35s
//
// The difference is the handshake, not the transport. Enabling domains
// (Runtime.enable / Page.enable / Network.enable) is what the site reacts to,
// so this bridge sends commands only and never any *.enable call.
//
// It implements the same three-method contract the owned-window drivers
// already use, so native-driver.mjs and native-page-driver.mjs are unchanged:
//   tabs()                  -> [{windowId, tabId, url}]
//   evaluate(tab, source)   -> parsed JSON value of the expression
//   navigate(tab, url)      -> resolves once the navigation is issued
// ---------------------------------------------------------------------------

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=(message,status)=>{const error=new Error(message);error.status=status;return error;};

// Chrome writes the port it actually bound to when launched with
// --remote-debugging-port=0. Reading it avoids guessing a free port.
//
// The file outlives the browser that wrote it, and a copied profile can carry a
// stale one, so the port must also answer /json/version before it is trusted:
// a dead port would otherwise fail later as a confusing "endpoint unreachable".
export async function devToolsPort(directory,{timeoutMs=15000,pollMs=100,fetchImpl=fetch}={}){
  const file=join(directory,'DevToolsActivePort');
  const deadline=Date.now()+timeoutMs;
  let lastCode='no file';
  while(Date.now()<deadline){
    let port=null;
    try{
      port=Number(readFileSync(file,'utf8').split('\n')[0].trim());
      if(!Number.isInteger(port)||port<=0){lastCode='malformed port';port=null;}
    }catch(error){lastCode=error.code??'unreadable';}
    if(port!==null){
      try{
        const response=await fetchImpl(`http://127.0.0.1:${port}/json/version`);
        if(response?.ok)return port;
        lastCode=`stale port ${port}`;
      }catch{lastCode=`stale port ${port}`;}
    }
    await pause(pollMs);
  }
  throw fail(`Chrome did not expose a live DevTools port (${lastCode})`,'browser_startup_timeout');
}

class Socket {
  constructor(url){
    this.url=url;this.ws=null;this.nextId=0;this.pending=new Map();this.closed=false;
  }
  async open(){
    const ws=this.ws=new WebSocket(this.url);
    ws.addEventListener('message',event=>{
      let message;
      try{message=JSON.parse(event.data);}catch{return;}
      const settle=message.id!==undefined&&this.pending.get(message.id);
      if(!settle)return;
      this.pending.delete(message.id);
      settle(message);
    });
    ws.addEventListener('close',()=>{
      this.closed=true;
      for(const settle of this.pending.values())settle(null);
      this.pending.clear();
    });
    await new Promise((resolve,reject)=>{
      ws.addEventListener('open',()=>resolve(),{once:true});
      ws.addEventListener('error',()=>reject(fail('DevTools socket could not be opened','browser_closed')),{once:true});
    });
    return this;
  }
  send(method,params={}){
    if(this.closed)return Promise.reject(fail('DevTools socket is closed','browser_closed'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,message=>{
        if(!message)return reject(fail('DevTools socket closed during a command','browser_closed'));
        if(message.error)return reject(fail(message.error.message||'DevTools command failed','extraction_failed'));
        resolve(message.result??{});
      });
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  close(){this.closed=true;try{this.ws?.close();}catch{/* already gone */}}
}

export async function createCdpBridge({root,session,onEvent=()=>{},startupTimeoutMs=15000,pollMs=100}={}){
  if(!session||typeof session.directory!=='string')throw fail('CDP bridge needs an owned browser session','browser_closed');
  const port=await devToolsPort(session.directory,{timeoutMs:startupTimeoutMs,pollMs});
  const endpoint=`http://127.0.0.1:${port}`;
  const sockets=new Map();
  onEvent({event:'cdp_bridge_connected',port,debugger:true});
  session.closed?.then(()=>{for(const socket of sockets.values())socket.close();sockets.clear();});

  const targets=async()=>{
    let list;
    try{list=await (await fetch(`${endpoint}/json/list`)).json();}
    catch{throw fail('DevTools endpoint is unreachable','browser_closed');}
    if(!Array.isArray(list))throw fail('DevTools endpoint returned an unexpected inventory','browser_closed');
    return list.filter(target=>target.type==='page')
      .map(target=>({windowId:1,tabId:target.id,url:target.url,debuggerUrl:target.webSocketDebuggerUrl}));
  };
  const socketFor=async tabId=>{
    const existing=sockets.get(tabId);
    if(existing&&!existing.closed)return existing;
    const live=(await targets()).find(target=>target.tabId===tabId);
    if(!live?.debuggerUrl)throw fail('Owned CDP target is unavailable','browser_closed');
    const socket=await new Socket(live.debuggerUrl).open();
    sockets.set(tabId,socket);
    return socket;
  };

  return {
    // Reports every tab of the owned window, exactly like the Apple Events
    // helper did; the drivers decide whether the inventory is acceptable.
    tabs:async()=>(await targets()).map(({windowId,tabId,url})=>({windowId,tabId,url})),
    // Commands only: no Runtime.enable, no Page.enable, no Network.enable.
    evaluate:async(tab,source)=>{
      const socket=await socketFor(tab.tabId);
      const result=await socket.send('Runtime.evaluate',{expression:source,returnByValue:true,awaitPromise:false});
      const details=result.exceptionDetails;
      if(details)throw fail(`Evaluation threw: ${details.exception?.description??details.text??'unknown'}`,'extraction_failed');
      const value=result.result?.value;
      if(typeof value!=='string')throw fail('Evaluation did not return a JSON string','extraction_failed');
      try{return JSON.parse(value);}
      catch{throw fail('Evaluation returned malformed JSON','extraction_failed');}
    },
    navigate:async(tab,url)=>{
      const socket=await socketFor(tab.tabId);
      await socket.send('Page.navigate',{url});
    },
    close:()=>{for(const socket of sockets.values())socket.close();sockets.clear();},
  };
}
