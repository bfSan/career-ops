import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readlinkSync,readdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,lstatSync} from 'node:fs';
import {tmpdir,hostname} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createServer} from 'node:net';
import {acquireBrowserProfile} from '../../china/browser-profile.mjs';
async function fixture(t,{alive=false,foreign=false,mismatch=false,listeningSocket=false}={}){
 const root=mkdtempSync(join(tmpdir(),'profile-recover-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'data/china/browser/boss');mkdirSync(directory,{recursive:true});
 const socketDir=mkdtempSync(join(tmpdir(),'com.google.Chrome.test-'));t.after(()=>rmSync(socketDir,{recursive:true,force:true}));const socket=join(socketDir,'SingletonSocket');
 const child=spawn(process.execPath,['-e',"require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('ready'));",socket],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});await once(child.stdout,'data');
 if(!alive){const exited=once(child,'exit');child.kill('SIGKILL');await exited;assert.ok(lstatSync(socket).isSocket());}
 if(listeningSocket){rmSync(socket);const server=createServer(s=>s.destroy());server.listen(socket);await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));}
 const current=hostname(),alias=current.endsWith('.lan')?current.replace(/\.lan$/,'.local'):current.replace(/\.local$/,'')+'.lan';
 const owner=`${foreign?'different-host.lan':alias}-${child.pid}`;
 symlinkSync(owner,join(directory,'SingletonLock'));symlinkSync(socket,join(directory,'SingletonSocket'));
 symlinkSync('fixture_cookie',join(directory,'SingletonCookie'));symlinkSync(mismatch?'other_cookie':'fixture_cookie',join(socketDir,'SingletonCookie'));
 writeFileSync(join(directory,'Cookies'),'unchanged login data');return {root,directory,owner};
}
test('dead local hostname-alias locks recover without changing cookie data or losing lock evidence',async t=>{
 const f=await fixture(t);const profile=await acquireBrowserProfile(f.root,'boss');profile.release();
 assert.equal(readFileSync(join(f.directory,'Cookies'),'utf8'),'unchanged login data');
 const backup=readdirSync(f.directory).find(n=>n.startsWith('.career-ops-stale-lock-'));assert.ok(backup);
 assert.equal(readlinkSync(join(f.directory,backup,'SingletonLock')),f.owner);
 assert.throws(()=>lstatSync(join(f.directory,'SingletonLock')),e=>e.code==='ENOENT');
 const next=await acquireBrowserProfile(f.root,'boss');next.release();
});
for(const scenario of [{alive:true},{foreign:true},{mismatch:true},{listeningSocket:true}])test(`uncertain/live lock ownership remains protected ${JSON.stringify(scenario)}`,async t=>{
 const f=await fixture(t,scenario);
 await assert.rejects(acquireBrowserProfile(f.root,'boss'),e=>e.status==='browser_profile_in_use');
 assert.equal(readlinkSync(join(f.directory,'SingletonLock')),f.owner);
 assert.equal(readdirSync(f.directory).some(n=>n.startsWith('.career-ops-stale-lock-')),false);
});
