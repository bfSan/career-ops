import {createHash} from 'node:crypto';
import {readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {atomicPrivateWrite} from './store.mjs';

const file=directory=>join(directory,'career-ops-session-cookies.json');
const maxAgeMs=24*60*60*1000;
const maxBytes=1024*1024;
// Hash the encrypted cookie store, without decrypting or printing its contents.
// A native Chrome login/logout or another writer makes the old cache ineligible.
function profileStamp(directory) {
  const hash=createHash('sha256');let found=false;
  for(const name of ['Default/Cookies','Default/Cookies-wal','Default/Network/Cookies','Default/Network/Cookies-wal']) {
    try{hash.update(name);hash.update(readFileSync(join(directory,name)));found=true;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return found?hash.digest('hex'):null;
}
const allowed=c=>c&&typeof c.name==='string'&&typeof c.value==='string'&&typeof c.path==='string'&&c.path.startsWith('/')
  && ['zhipin.com','.zhipin.com','www.zhipin.com'].includes(c.domain)&&c.expires===-1
  && typeof c.httpOnly==='boolean'&&typeof c.secure==='boolean'&&['Strict','Lax','None'].includes(c.sameSite)
  && c.partitionKey===undefined;

export function discardSessionCookies(directory){rmSync(file(directory),{force:true});}

export function loadSessionCookies(directory,channel) {
  try{
    if(statSync(file(directory)).size>maxBytes)return {cookies:[],reason:'invalid_cache'};
    const saved=JSON.parse(readFileSync(file(directory),'utf8'));
    const age=Date.now()-Date.parse(saved.savedAt);
    if(saved.schemaVersion!==1||saved.channel!==channel||!Array.isArray(saved.cookies)||saved.cookies.length>100||!saved.cookies.every(allowed))return {cookies:[],reason:'invalid_cache'};
    if(!Number.isFinite(age)||age<0||age>maxAgeMs)return {cookies:[],reason:'expired_cache'};
    if(!saved.profileStamp||saved.profileStamp!==profileStamp(directory))return {cookies:[],reason:'profile_changed'};
    return {cookies:saved.cookies,reason:'saved_session'};
  }catch(error){return {cookies:[],reason:error.code==='ENOENT'?'no_cache':'invalid_cache'};}
}

// Call after graceful browser shutdown while still holding the profile lease.
// Persistent auth cookies stay in Chrome's encrypted store, not in this file.
export function saveSessionCookies(directory,channel,cookies) {
  const session=cookies.filter(allowed),stamp=profileStamp(directory);
  if(!session.length||!stamp){discardSessionCookies(directory);return;}
  const text=JSON.stringify({schemaVersion:1,channel,savedAt:new Date().toISOString(),profileStamp:stamp,cookies:session},null,2)+'\n';
  if(session.length>100||Buffer.byteLength(text)>maxBytes)throw new Error('Session cookie cache exceeds its size limit');
  atomicPrivateWrite(file(directory),text);
}
