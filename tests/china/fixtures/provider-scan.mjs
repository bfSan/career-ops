import {mkdtempSync,rmSync,readdirSync,copyFileSync,cpSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setupProviders} from '../../../china/setup-providers.mjs';

export function scanFixture(t,dataRoot) {
  const codeRoot=mkdtempSync(join(tmpdir(),'provider-code-'));
  t.after(()=>rmSync(codeRoot,{recursive:true,force:true}));
  const repo=fileURLToPath(new URL('../../../',import.meta.url));
  for(const name of readdirSync(repo))if(name.endsWith('.mjs')||name.endsWith('.json'))copyFileSync(join(repo,name),join(codeRoot,name));
  for(const name of ['lib','providers','plugins','china','templates'])cpSync(join(repo,name),join(codeRoot,name),{recursive:true});
  symlinkSync(join(repo,'node_modules'),join(codeRoot,'node_modules'),'dir');
  mkdirSync(join(codeRoot,'config'));
  setupProviders({codeRoot});
  writeFileSync(join(codeRoot,'config/plugins.yml'),'plugins:\n  career-boss:\n    enabled: true\n');
  // Provider fetch is archive-only. Any accidental generic network access fails.
  writeFileSync(join(codeRoot,'no-network.cjs'),"globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN_IN_ARCHIVE_SCAN')};\n");
  const env={...process.env,CAREER_OPS_ROOT:dataRoot,CAREER_OPS_DATA_DIR:dataRoot,
    CAREER_OPS_PORTALS:join(dataRoot,'portals.yml'),CAREER_OPS_PROFILE:join(dataRoot,'config/profile.yml'),
    CAREER_OPS_PIPELINE:join(dataRoot,'data/pipeline.md'),CAREER_OPS_SCAN_HISTORY:join(dataRoot,'data/scan-history.tsv'),
    CAREER_OPS_TRACKER:join(dataRoot,'data/applications.md')};
  return {codeRoot,run:(args=[])=>spawnSync(process.execPath,['--require',join(codeRoot,'no-network.cjs'),join(codeRoot,'scan.mjs'),...args],{cwd:codeRoot,env,encoding:'utf8',timeout:20000})};
}
