import {createHash} from 'node:crypto';
import {readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {atomicPrivateWrite} from './store.mjs';

const file=directory=>join(directory,'career-ops-session-cookies.json');
const maxAgeMs=24*60*60*1000;
const maxBytes=1024*1024;
// Only these hosts may enter the reusable cache. Everything else is dropped
// before it is written, so the cache can never widen a login beyond the site
// the session was actually established for.
const platformDomains=new Map([
  ['boss',['zhipin.com','.zhipin.com','www.zhipin.com']],
  ['liepin',['liepin.com','.liepin.com','www.liepin.com']],
]);
export function supportsSessionCookies(platform){return platformDomains.has(platform);}
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
  && typeof c.domain==='string'&&c.expires===-1
  && typeof c.httpOnly==='boolean'&&typeof c.secure==='boolean'&&['Strict','Lax','None'].includes(c.sameSite)
  && c.partitionKey===undefined;
const allowedFor=platform=>c=>{
  const domains=platformDomains.get(platform);
  return domains?allowed(c)&&domains.includes(c.domain):false;
};

export function discardSessionCookies(directory){rmSync(file(directory),{force:true});}

export function loadSessionCookies(directory,channel,platform='boss') {
  // Answer before touching the file: an unsupported platform is refused
  // regardless of whether a cache happens to exist on disk.
  if(!supportsSessionCookies(platform))return {cookies:[],reason:'unsupported_platform'};
  const permitted=allowedFor(platform);
  try{
    if(statSync(file(directory)).size>maxBytes)return {cookies:[],reason:'invalid_cache'};
    const saved=JSON.parse(readFileSync(file(directory),'utf8'));
    const age=Date.now()-Date.parse(saved.savedAt);
    if(saved.schemaVersion!==1||saved.channel!==channel||!Array.isArray(saved.cookies)||saved.cookies.length>100||!saved.cookies.every(permitted))return {cookies:[],reason:'invalid_cache'};
    if(!Number.isFinite(age)||age<0||age>maxAgeMs)return {cookies:[],reason:'expired_cache'};
    if(!saved.profileStamp||saved.profileStamp!==profileStamp(directory))return {cookies:[],reason:'profile_changed'};
    return {cookies:saved.cookies,reason:'saved_session'};
  }catch(error){return {cookies:[],reason:error.code==='ENOENT'?'no_cache':'invalid_cache'};}
}

// Call after graceful browser shutdown while still holding the profile lease.
// Persistent auth cookies stay in Chrome's encrypted store, not in this file.
export function saveSessionCookies(directory,channel,cookies,platform='boss') {
  // A platform with no reusable login has no business here, and deleting would
  // throw away another site's still-valid session. Leave the file untouched.
  if(!supportsSessionCookies(platform))return;
  const permitted=allowedFor(platform);
  const session=cookies.filter(permitted),stamp=profileStamp(directory);
  if(!session.length||!stamp){discardSessionCookies(directory);return;}
  const text=JSON.stringify({schemaVersion:1,channel,savedAt:new Date().toISOString(),profileStamp:stamp,cookies:session},null,2)+'\n';
  if(session.length>100||Buffer.byteLength(text)>maxBytes)throw new Error('Session cookie cache exceeds its size limit');
  atomicPrivateWrite(file(directory),text);
}
