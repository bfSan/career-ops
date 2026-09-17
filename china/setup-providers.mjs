import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const definitions = [
  ['career-boss', 'boss', 'Read frozen BOSS job archives from an explicit market study.'],
  ['career-liepin', 'liepin', 'Read frozen Liepin job archives from an explicit market study.'],
  ['career-linkedin', 'linkedin', 'Read frozen LinkedIn job archives from an explicit market study.'],
];

function files(id, platform, description) {
  const manifest = { id, name: id === 'career-boss' ? 'Career BOSS archive' : id === 'career-linkedin' ? 'Career LinkedIn archive' : 'Career Liepin archive', version: '1.0.0', apiVersion: 1,
    description, hooks: ['provider'], requiredEnv: [], allowedHosts: [], humanInTheLoop: true, entry: 'index.mjs' };
  return new Map([
    ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['index.mjs', `import { createArchiveProvider } from '../../china/provider-plugin.mjs';\nexport default { provider: createArchiveProvider('${platform}') };\n`],
  ]);
}

export function setupProviders({ codeRoot }) {
  if (!codeRoot) throw new Error('codeRoot is required');
  codeRoot = realpathSync(codeRoot);
  const result = { created: [], reused: [], conflict: [] };
  const planned = definitions.map(def => ({ id: def[0], expected: files(...def), dir: join(codeRoot, 'plugins.local', def[0]) }));
  for (const { id, expected, dir } of planned) {
    for (const path of [join(codeRoot, 'plugins.local'), dir, ...[...expected.keys()].map(name => join(dir, name))]) {
      try { if (lstatSync(path).isSymbolicLink()) throw new Error(`provider setup symlink: ${path}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let changed = false;
    for (const [name, content] of expected) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) result.conflict.push(`${id}/${name}`);
      if (!existsSync(path)) changed = true;
    }
    if (!changed && !result.conflict.some(value => value.startsWith(`${id}/`))) result.reused.push(id);
  }
  if (result.conflict.length) { const error = new Error(`provider setup conflict: ${result.conflict.join(', ')}`); error.result = result; throw error; }
  for (const { id, expected, dir } of planned) {
    if (result.reused.includes(id)) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const [name, content] of expected) {
      const path = join(dir, name);
      if (!existsSync(path)) writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    result.created.push(id);
  }
  return result;
}
