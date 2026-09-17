import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildCtx, mergeProviderPlugins, runHook } from '../plugins/_engine.mjs';

const manifest = (id, hooks) => ({
  id,
  apiVersion: 1,
  description: `${id} test plugin`,
  hooks,
  requiredEnv: [],
  optionalEnv: [],
  allowedHosts: [],
  humanInTheLoop: true,
  entry: 'index.mjs',
});

function fixture({ id, hooks, entry, enabled = true }) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-code-root-'));
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-data-root-'));
  const pluginDir = join(root, 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'research'), { recursive: true });
  mkdirSync(join(dataRoot, 'research'), { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest(id, hooks)));
  writeFileSync(join(pluginDir, 'index.mjs'), entry);
  writeFileSync(join(root, 'config', 'plugins.yml'), `plugins:\n  ${id}:\n    enabled: ${enabled}\n`);
  writeFileSync(join(root, 'research', 'title.txt'), 'WRONG_ROOT');
  writeFileSync(join(dataRoot, 'research', 'title.txt'), 'RIGHT_ROOT');
  return { root, dataRoot, cleanup: () => { rmSync(root, { recursive: true, force: true }); rmSync(dataRoot, { recursive: true, force: true }); } };
}

test('buildCtx exposes the explicit data root and dry-run flag', () => {
  const ctx = buildCtx(manifest('ctx-check', ['ingest']), { dataRoot: '/tmp/research-b', dryRun: true });
  assert.equal(ctx.dataRoot, '/tmp/research-b');
  assert.equal(ctx.dryRun, true);
});

test('buildCtx makes only dataRoot read-only while retaining unrelated context behavior', () => {
  const ctx = buildCtx(manifest('readonly-check', ['ingest']), { dataRoot: '/tmp/original-root', dryRun: true });

  assert.throws(() => { ctx.dataRoot = '/tmp/reassigned-root'; }, TypeError);
  assert.throws(() => { Object.defineProperty(ctx, 'dataRoot', { value: '/tmp/replaced-root' }); }, TypeError);
  assert.equal(ctx.dataRoot, '/tmp/original-root');

  ctx.dryRun = false;
  assert.equal(ctx.dryRun, false);
  assert.equal(ctx.transport, 'http');
  assert.equal(typeof ctx.fetch, 'function');
  assert.equal(typeof ctx.log, 'function');
});

test('provider hook reads from dataRoot while plugin discovery stays under root', async () => {
  const f = fixture({
    id: 'data-reader',
    hooks: ['provider'],
    entry: `import { readFileSync } from 'node:fs'; import { join } from 'node:path';
      export default { provider: { id: 'data-reader', fetch: async (_entry, ctx) => [{ title: readFileSync(join(ctx.dataRoot, 'research', 'title.txt'), 'utf8'), dryRun: ctx.dryRun }] } };`,
  });
  try {
    const providers = new Map();
    await mergeProviderPlugins(providers, { root: f.root, dataRoot: f.dataRoot, dryRun: true });
    assert.equal(providers.has('data-reader'), true, 'plugin must still be discovered from the code root');
    const jobs = await providers.get('data-reader').fetch({});
    assert.equal(jobs[0].title, 'RIGHT_ROOT');
    assert.equal(jobs[0].dryRun, true);
  } finally { f.cleanup(); }
});

test('runHook passes dataRoot and dryRun to an enabled real hook', async () => {
  const f = fixture({
    id: 'ingest-reader',
    hooks: ['ingest'],
    entry: `import { readFileSync } from 'node:fs'; import { join } from 'node:path';
      export default { ingest: async (ctx) => ({ title: readFileSync(join(ctx.dataRoot, 'research', 'title.txt'), 'utf8'), dryRun: ctx.dryRun }) };`,
  });
  try {
    const results = await runHook('ingest', null, { root: f.root, dataRoot: f.dataRoot, dryRun: true });
    assert.deepEqual(results.map(({ id, ok, result }) => ({ id, ok, result })), [
      { id: 'ingest-reader', ok: true, result: { title: 'RIGHT_ROOT', dryRun: true } },
    ]);
  } finally { f.cleanup(); }
});

test('disabled plugin hook does not execute when dataRoot is supplied', async () => {
  delete globalThis.__dataRootDisabledHookRan;
  const f = fixture({
    id: 'disabled-reader',
    hooks: ['ingest'],
    enabled: false,
    entry: `export default { ingest: async () => { globalThis.__dataRootDisabledHookRan = true; return {}; } };`,
  });
  try {
    const results = await runHook('ingest', null, { root: f.root, dataRoot: f.dataRoot, dryRun: true });
    assert.deepEqual(results, []);
    assert.equal(globalThis.__dataRootDisabledHookRan, undefined);
  } finally { f.cleanup(); delete globalThis.__dataRootDisabledHookRan; }
});

test('legacy calls default plugin dataRoot to root', async () => {
  const f = fixture({
    id: 'legacy-reader',
    hooks: ['provider'],
    entry: `import { readFileSync } from 'node:fs'; import { join } from 'node:path';
      export default { provider: { id: 'legacy-reader', fetch: async (_entry, ctx) => [{ title: readFileSync(join(ctx.dataRoot, 'research', 'title.txt'), 'utf8') }] } };`,
  });
  try {
    const providers = new Map();
    await mergeProviderPlugins(providers, { root: f.root });
    const jobs = await providers.get('legacy-reader').fetch({});
    assert.equal(jobs[0].title, 'WRONG_ROOT');
  } finally { f.cleanup(); }
});
