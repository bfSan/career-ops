import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupProviders } from '../../china/setup-providers.mjs';

test('setup refuses symlinked plugin roots without writing outside the code root', t => {
  const root = mkdtempSync(join(tmpdir(), 'setup-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'setup-outside-'));
  t.after(() => { rmSync(root, {recursive:true,force:true}); rmSync(outside, {recursive:true,force:true}); });
  symlinkSync(outside, join(root, 'plugins.local'));
  assert.throws(() => setupProviders({codeRoot:root}), /symlink/);
  assert.equal(existsSync(join(outside, 'career-boss')), false);
});

test('setup creates three complete disabled-by-default provider plugins and then reuses them', t => {
  const root = mkdtempSync(join(tmpdir(), 'setup-providers-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = setupProviders({ codeRoot: root });
  assert.deepEqual(first, { created: ['career-boss', 'career-liepin', 'career-linkedin'], reused: [], conflict: [] });
  for (const [id, platform] of [['career-boss', 'boss'], ['career-liepin', 'liepin'], ['career-linkedin', 'linkedin']]) {
    const dir = join(root, 'plugins.local', id);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json')));
    assert.equal(manifest.id, id); assert.equal(manifest.apiVersion, 1); assert.deepEqual(manifest.hooks, ['provider']);
    assert.deepEqual(manifest.requiredEnv, []); assert.deepEqual(manifest.allowedHosts, []); assert.equal(manifest.humanInTheLoop, true);
    assert.equal(manifest.entry, 'index.mjs');
    assert.equal(readFileSync(join(dir, 'index.mjs'), 'utf8'), `import { createArchiveProvider } from '../../china/provider-plugin.mjs';\nexport default { provider: createArchiveProvider('${platform}') };\n`);
  }
  assert.equal(existsSync(join(root, 'config/plugins.yml')), false);
  assert.deepEqual(setupProviders({ codeRoot: root }), { created: [], reused: ['career-boss', 'career-liepin', 'career-linkedin'], conflict: [] });
});

test('setup reports conflict and preserves any existing differing bytes', t => {
  const root = mkdtempSync(join(tmpdir(), 'setup-conflict-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  setupProviders({ codeRoot: root });
  const file = join(root, 'plugins.local/career-boss/index.mjs'); writeFileSync(file, 'user change\n');
  assert.throws(() => setupProviders({ codeRoot: root }), error => {
    assert.deepEqual(error.result, { created: [], reused: ['career-liepin', 'career-linkedin'], conflict: ['career-boss/index.mjs'] }); return /conflict/.test(error.message);
  });
  assert.equal(readFileSync(file, 'utf8'), 'user change\n');
});

test('setup repairs a missing generated file without rewriting matching bytes', t => {
  const root = mkdtempSync(join(tmpdir(), 'setup-partial-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  setupProviders({ codeRoot: root });
  const manifest = join(root, 'plugins.local/career-boss/manifest.json');
  const before = readFileSync(manifest); unlinkSync(join(root, 'plugins.local/career-boss/index.mjs'));
  assert.deepEqual(setupProviders({ codeRoot: root }), { created: ['career-boss'], reused: ['career-liepin', 'career-linkedin'], conflict: [] });
  assert.deepEqual(readFileSync(manifest), before);
});
