import {spawn} from 'node:child_process';
import {accessSync,constants} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright';
import {validateLoginUrl} from './platforms.mjs';
import {acquireBrowserProfile} from './browser-profile.mjs';

function browserExecutable(channel) {
  if(!['chrome','chromium','msedge'].includes(channel)) throw new Error('Unsupported browser channel');
  if(channel==='chromium') return chromium.executablePath();
  const app=channel==='chrome'?'Google Chrome':'Microsoft Edge';
  const candidates=process.platform==='darwin'
    ? ['/Applications',join(homedir(),'Applications')].map(base=>join(base,`${app}.app`,'Contents','MacOS',app))
    : process.platform==='win32'
      ? [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(base=>join(base,channel==='chrome'?'Google/Chrome/Application/chrome.exe':'Microsoft/Edge/Application/msedge.exe'))
      : (channel==='chrome'?['/opt/google/chrome/chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable']:['/opt/microsoft/msedge/msedge','/usr/bin/microsoft-edge']);
  for(const path of candidates) {try {accessSync(path,constants.X_OK);return path;}catch { /* Try the next installed location. */ }}
  throw new Error(`${app} executable not found; install the browser or choose --channel chromium.`);
}

// Deliberately no automation/debugging connection: BOSS's sign page can react
// to Runtime console inspection by calling history.back() and clearing the DOM.
// This phase is user-operated; process startup does not prove page readiness.
export async function openNativeLogin({root,platform,url,channel='chrome',executablePath,startupMs=1000,closeTimeoutMs=15000}) {
  validateLoginUrl(platform,url);
  const executable=executablePath || browserExecutable(channel);
  accessSync(executable,constants.X_OK);
  const profile=await acquireBrowserProfile(root,platform);
  let child;
  try {
    child=spawn(executable,[`--user-data-dir=${profile.directory}`,'--no-first-run','--no-default-browser-check','--new-window',url],{
      shell:false,detached:true,stdio:'ignore',
    });
  }catch(error) {profile.release();throw error;}
  let ended=null,launchError=null,cancelled=false,cancel;
  const closed=new Promise(resolve=>{
    child.once('error',error=>{launchError=error.code;});
    child.once('close',(code,signal)=>{
      ended=launchError?{status:'launch_failed',error:launchError}:{status:'closed',code,signal};
      process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
      profile.release();resolve(ended);
    });
  });
  let closing;
  const close=()=>closing ||= (async()=>{
    if(ended) return ended;
    child.kill('SIGTERM');
    let deadline;
    try {
      return await Promise.race([closed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Dedicated browser did not exit; close its window before scanning.')),closeTimeoutMs);})]);
    }finally {clearTimeout(deadline);}
  })();
  // Cover startup and the entire shutdown, including a second Ctrl+C while
  // Chrome is flushing its profile. A detached child never receives CLI signals.
  cancel=()=>{cancelled=true;void close().catch(()=>{});};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  let timer;
  const early=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),startupMs);})]);
  clearTimeout(timer);
  if(cancelled) {await close();throw new Error('Native browser startup cancelled.');}
  if(early) throw new Error(`Native browser exited during startup (${early.error ?? early.code ?? early.signal ?? 'unknown'}); no owned login window was confirmed.`);
  return {pid:child.pid,directory:profile.directory,closed,close,get cancelled(){return cancelled;}};
}

export async function waitForNativeLogin({session,input=process.stdin,output=process.stderr,timeoutMs=20*60*1000}) {
  const rl=createInterface({input,output});
  let timer,cancel;
  const answer=new Promise(resolve=>{
    cancel=()=>resolve('cancelled');
    rl.once('line',()=>resolve('confirm'));
    rl.once('close',cancel);
    rl.once('SIGINT',cancel);
    timer=setTimeout(()=>resolve('login_timeout'),timeoutMs);
  });
  let result,exit;
  try {
    result=await Promise.race([answer,session.closed.then(()=> 'cancelled')]);
  }finally {
    clearTimeout(timer);rl.close();
    // Wait for Chrome's normal shutdown/profile flush before allowing a scan.
    exit=await session.close();
  }
  if(session.cancelled) return {status:'cancelled'};
  if(exit.code!==0 || exit.signal) return {status:'browser_exit_error'};
  return {status:result==='confirm'?'session_unverified':result};
}
