import {mkdirSync,realpathSync,readlinkSync,lstatSync,mkdtempSync,renameSync} from 'node:fs';
import {join,dirname,basename,relative,isAbsolute} from 'node:path';
import {hostname,tmpdir} from 'node:os';
import {connect} from 'node:net';
import {acquirePipelineLock} from '../pipeline-lock.mjs';
import {searchUrl} from './platforms.mjs';

const alive = pid => {
  try {process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}
};
const busy = message => Object.assign(new Error(message),{status:'browser_profile_in_use'});
async function socketInactive(path) {
  return new Promise(resolve=>{
    const socket=connect(path);
    const done=value=>{socket.destroy();resolve(value);};
    socket.once('connect',()=>done(false));socket.once('error',error=>done(['ECONNREFUSED','ENOENT'].includes(error.code)));
    socket.setTimeout(300,()=>done(false));
  });
}

// macOS may switch the same machine between .lan and .local. Recover only a
// dead local alias with matching Chrome cookie/socket evidence in our temp dir.
async function recoverLocalAlias(directory,owner,match) {
  const local=hostname(),stem=value=>value.replace(/\.(?:local|lan)$/,'');
  if(!match||match[1]===local||stem(match[1])!==stem(local)||alive(Number(match[2])))return false;
  const names=['SingletonLock','SingletonSocket','SingletonCookie'];
  let links,stats,socket;
  try {
    links=names.map(name=>readlinkSync(join(directory,name)));
    stats=names.map(name=>lstatSync(join(directory,name)));
    if(links[0]!==owner||stats.some(stat=>!stat.isSymbolicLink()||stat.uid!==process.getuid?.()))return false;
    socket=links[1];
    const temp=realpathSync(tmpdir()),parent=realpathSync(dirname(socket)),rel=relative(temp,parent);
    if(!isAbsolute(socket)||!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel)||!/^com\.google\.Chrome\./.test(basename(parent)))return false;
    const stat=lstatSync(socket);
    if(!stat.isSocket()||stat.uid!==process.getuid?.()||readlinkSync(join(parent,'SingletonCookie'))!==links[2])return false;
  }catch{return false;}
  if(!await socketInactive(socket)||alive(Number(match[2])))return false;
  // Refuse any changed ownership evidence rather than racing a newly started Chrome.
  if(names.some((name,i)=>{try{const path=join(directory,name),stat=lstatSync(path);return stat.ino!==stats[i].ino||readlinkSync(path)!==links[i];}catch{return true;}}))return false;
  const backup=mkdtempSync(join(directory,'.career-ops-stale-lock-'));
  for(const name of names)renameSync(join(directory,name),join(backup,name));
  return true;
}

// Both native login and automated scanning hold this lease until their browser
// exits. Resolve aliases so two spellings of a data root share the same lock.
export async function acquireBrowserProfile(root,platform) {
  searchUrl(platform,'Agent');
  const path=join(root,'data','china','browser',platform);
  mkdirSync(path,{recursive:true,mode:0o700});
  const directory=realpathSync(path);
  let lease;
  try {lease=await acquirePipelineLock(directory,{timeoutMs:150,maxWaitMs:300});}
  catch(error) {
    if(error.name==='LockTimeoutError') throw Object.assign(new Error('Browser profile is in use; finish the existing login or scan first.'),{status:'browser_profile_in_use'});
    throw error;
  }
  try {
    // Chrome can otherwise silently forward the URL to another Chrome process
    // and exit successfully. Never attach to or terminate that other process.
    let owner;
    try {owner=readlinkSync(join(directory,'SingletonLock'));}
    catch(error) {if(error.code!=='ENOENT') throw error;}
    if(owner) {
      const match=/^(.*)-(\d+)$/.exec(owner);
      const sameHost=match&&match[1]===hostname();
      if(!(sameHost&&!alive(Number(match[2])))&&!await recoverLocalAlias(directory,owner,match))
        throw busy('Browser profile is in use by Chrome; close that dedicated browser first.');
      // Same-host stale locks still use Chrome's own recovery; alias recovery above preserves a private backup.
    }
    return {directory,release:()=>lease.release()};
  }catch(error) {lease.release();throw error;}
}
