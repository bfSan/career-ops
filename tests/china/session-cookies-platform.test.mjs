import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadSessionCookies,saveSessionCookies,discardSessionCookies,supportsSessionCookies} from '../../china/session-cookies.mjs';

// The session cache exists so a platform whose login cannot be re-established
// automatically does not silently fall back to signed-out browsing. These tests
// pin the platform scoping: a cache is reusable only by the site it was made
// for, and an unknown platform is refused rather than trusted.
const session=(name,domain,extra={})=>({
  name,value:`value-${name}`,domain,path:'/',expires:-1,
  httpOnly:true,secure:true,sameSite:'None',...extra,
});
const profile=()=>{
  const directory=mkdtempSync(join(tmpdir(),'career-ops-session-'));
  mkdirSync(join(directory,'Default'),{recursive:true});
  writeFileSync(join(directory,'Default','Cookies'),'store');
  return directory;
};

test('the session cache is scoped to the platforms that have a login to preserve',()=>{
  assert.equal(supportsSessionCookies('boss'),true);
  assert.equal(supportsSessionCookies('liepin'),true);
  // An unknown platform must not be able to read or write the cache at all.
  assert.equal(supportsSessionCookies('linkedin'),false);
  assert.equal(supportsSessionCookies(''),false);
  assert.equal(supportsSessionCookies('toString'),false,'inherited keys are not platforms');
});

test('a Liepin session is saved and reloaded for Liepin only',t=>{
  const directory=profile();
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  saveSessionCookies(directory,'chrome',[session('sso','liepin.com')],'liepin');
  const loaded=loadSessionCookies(directory,'chrome','liepin');
  assert.equal(loaded.reason,'saved_session');
  assert.equal(loaded.cookies.length,1);
  assert.equal(loaded.cookies[0].name,'sso');
  // The same file must not be handed to a different site: a Liepin login is
  // not a BOSS login, and mixing them would widen one session into another.
  assert.notEqual(loadSessionCookies(directory,'chrome','boss').cookies.length,1);
});

test('a BOSS session still round-trips unchanged',t=>{
  const directory=profile();
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  saveSessionCookies(directory,'chrome',[session('zp_at','.zhipin.com')],'boss');
  const loaded=loadSessionCookies(directory,'chrome','boss');
  assert.equal(loaded.reason,'saved_session');
  assert.equal(loaded.cookies[0].name,'zp_at');
});

test('a foreign-domain cookie is never written into the cache',t=>{
  const directory=profile();
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  saveSessionCookies(directory,'chrome',[
    session('keep','liepin.com'),
    session('leak','evil.example'),
  ],'liepin');
  const loaded=loadSessionCookies(directory,'chrome','liepin');
  assert.equal(loaded.cookies.length,1);
  assert.equal(loaded.cookies[0].name,'keep');
});

test('an unsupported platform neither writes nor reads the cache',t=>{
  const directory=profile();
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  saveSessionCookies(directory,'chrome',[session('x','liepin.com')],'linkedin');
  // Nothing may have been created for a platform that cannot hold a login.
  assert.equal(loadSessionCookies(directory,'chrome','linkedin').reason,'unsupported_platform');
  saveSessionCookies(directory,'chrome',[session('sso','liepin.com')],'liepin');
  assert.equal(loadSessionCookies(directory,'chrome','linkedin').cookies.length,0);
});

test('a channel or profile change still invalidates the cache',t=>{
  const directory=profile();
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  saveSessionCookies(directory,'chrome',[session('sso','liepin.com')],'liepin');
  assert.equal(loadSessionCookies(directory,'edge','liepin').reason,'invalid_cache');
  writeFileSync(join(directory,'Default','Cookies'),'changed-by-a-new-login');
  assert.equal(loadSessionCookies(directory,'chrome','liepin').reason,'profile_changed');
  discardSessionCookies(directory);
  assert.equal(loadSessionCookies(directory,'chrome','liepin').reason,'no_cache');
});
