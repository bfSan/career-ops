import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed, options, analysis } from './fixtures/market-data.mjs';
import { readStudy } from '../../china/market-study.mjs';
const entry = fileURLToPath(new URL('../../china-market.mjs', import.meta.url));
function setup(t, seeded = true) {
  const root = mkdtempSync(join(tmpdir(), 'market-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = args => spawnSync(process.execPath, [entry, ...args, '--root', root], { encoding: 'utf8', timeout: 10000 });
  const file = join(root, 'input.json');
  const put = value => writeFileSync(file, JSON.stringify(value));
  if (seeded) { const { selected } = seed(root); const { scope } = options(selected); put({ scope, selected }); }
  return { root, run, file, put };
}
function prepared(t) {
  const f = setup(t);
  assert.equal(f.run(['prepare', '--study', 'market-fixture', '--selection', f.file]).status, 0);
  const study = readStudy(f.root, 'market-fixture'), bundle = analysis(study);
  f.put(bundle);
  return { ...f, study, bundle, args: ['report', '--study', 'market-fixture', '--file', f.file] };
}
test('help and malformed inputs are read-only; JSON inputs are bounded regular files', t => {
  const { root, run, file, put } = setup(t, false);
  assert.equal(run(['--help']).status, 0);
  for (const args of [['prepare', '--study', '../bad', '--selection', file], ['report', '--study', 'ok', '--surprise'], ['prepare', '--study', 'ok', '--selection', root]]) assert.equal(run(args).status, 1);
  for (const value of ['{', ' '.repeat(10 * 1024 * 1024 + 1)]) { writeFileSync(file, value); assert.equal(run(['prepare', '--study', 'ok', '--selection', file]).status, 1); }
  put({ scope: {}, selected: [], studyId: 'override' });
  assert.equal(run(['prepare', '--study', 'ok', '--selection', file]).status, 1);
  assert.equal(existsSync(join(root, 'data')), false);
});
test('CLI publishes private reproducible reports without changing store or captures', t => {
  const f = prepared(t), store = join(f.root, 'data/china/store.json'), capture = join(f.root, f.study.sources[0].capturePath);
  const before = [readFileSync(store), readFileSync(capture)];
  assert.equal(f.run(['validate', ...f.args.slice(1)]).status, 0);
  const result = f.run(f.args); assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout); assert.equal(out.status, 'created');
  const names = ['summary.json', 'requirements.csv', 'analysis.json', 'validation.json', 'market-report.md'];
  assert.deepEqual(readdirSync(out.reportDir).sort(), names.sort());
  const bytes = names.map(name => readFileSync(join(out.reportDir, name)));
  for (const name of names) assert.equal(statSync(join(out.reportDir, name)).mode & 0o077, 0);
  const md = readFileSync(join(out.reportDir, 'market-report.md'), 'utf8');
  assert.match(md, /reviewedWithoutMention/); assert.match(md, /marketfixture/); assert.match(md, /anonymousOrUnknownJobs/);
  writeFileSync(join(out.reportDir, 'interpretation.md'), 'human interpretation');
  assert.equal(JSON.parse(f.run(f.args).stdout).status, 'reused');
  names.forEach((name, i) => assert.deepEqual(readFileSync(join(out.reportDir, name)), bytes[i]));
  assert.deepEqual(readFileSync(store), before[0]); assert.deepEqual(readFileSync(capture), before[1]);
  writeFileSync(join(out.reportDir, 'requirements.csv'), 'tampered');
  assert.equal(f.run(f.args).status, 1);
});
test('invalid bundles do not publish; incomplete reviews publish with exit 2', t => {
  const f = prepared(t); f.bundle.sourceDigest = 'bad'; f.put(f.bundle);
  assert.equal(f.run(f.args).status, 2); assert.equal(existsSync(join(f.root, 'reports')), false);
  f.bundle.sourceDigest = f.study.manifest.sourceDigest;
  f.bundle.records[0].coverage.skill = 'not_reviewed'; f.put(f.bundle);
  const result = f.run(f.args); assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(JSON.parse(result.stdout).reportDir, 'summary.json'))).complete, false);
});
test('concurrent reports publish once and reject symlink report ancestors before locks', async t => {
  const f = prepared(t);
  const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, [entry, ...f.args, '--root', f.root]); let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); });
  const results = await Promise.all([run(), run()]);
  results.forEach(r => assert.equal(r.status, 0, r.stderr));
  assert.deepEqual(results.map(r => JSON.parse(r.stdout).status).sort(), ['created', 'reused']);
  const other = setup(t, false).root; rmSync(join(f.root, 'reports'), { recursive: true }); symlinkSync(other, join(f.root, 'reports'));
  assert.equal(f.run(f.args).status, 1); assert.deepEqual(readdirSync(other), []);
});
test('Markdown escapes raw cells and retains headers and zero-row reviewed denominators', async t => {
  const { renderMarketReport } = await import('../../china-market.mjs');
  const { summarize } = await import('../../china/market-summary.mjs');
  const { validateBundle } = await import('../../china/market-analysis.mjs');
  const f = prepared(t); f.bundle.records[0].requirements = [];
  const summary = summarize(f.study, f.bundle);
  const displayed = structuredClone(f.study); displayed.sources[0].fields.title = '<script>x</script>|line\nnext';
  const md = renderMarketReport(displayed, summary, validateBundle(f.study, f.bundle));
  assert.match(md, /&lt;script&gt;x&lt;\/script&gt;&#124;line<br>next/);
  assert.match(md, /\| unknown \| unknown \| skill \| 1 \| 1 \| 0 \| 1 \|/);
  assert.match(md, /\| cityGroup \| roleFamily \| dimension \| subject \| kind \| count \| denominator \| jobKeys \|/);
});
test('source digest tampering and symlinked immutable files fail without rewriting reports', t => {
  const f = prepared(t), result = f.run(f.args), out = JSON.parse(result.stdout);
  const report = join(out.reportDir, 'analysis.json'), outside = join(f.root, 'copy.json');
  writeFileSync(outside, readFileSync(report), { mode: 0o600 }); rmSync(report); symlinkSync(outside, report);
  assert.equal(f.run(f.args).status, 1);
  rmSync(join(f.root, 'reports'), { recursive: true });
  const manifest = join(f.root, 'data/china/research/market-fixture/manifest.json');
  const value = JSON.parse(readFileSync(manifest)); value.sourceDigest = 'bad'; writeFileSync(manifest, JSON.stringify(value));
  assert.equal(f.run(f.args).status, 1); assert.equal(existsSync(join(f.root, 'reports')), false);
});
test('Markdown evidence stays literal for image links, URLs, code and backslashes', async t => {
  const { renderMarketReport } = await import('../../china-market.mjs');
  const { summarize, renderRequirementsCsv } = await import('../../china/market-summary.mjs');
  const { validateBundle } = await import('../../china/market-analysis.mjs');
  const { fingerprint } = await import('../../china/store.mjs');
  const f = prepared(t), source = f.study.sources[0];
  const raw = '![tracker](https://example.invalid/pixel) [link](https://example.invalid/) `code` \\ *bold* _emphasis_ www.example.invalid test@example.invalid';
  const start = source.fields.description.length; source.fields.description += raw;
  const { listingText, ...content } = source.fields; source.contentHash = fingerprint(content);
  f.study.manifest.selected[0].contentHash = source.contentHash;
  f.study.manifest.sourceDigest = fingerprint({ scope: f.study.manifest.scope, sources: f.study.sources });
  f.bundle.sourceDigest = f.study.manifest.sourceDigest;
  const record = f.bundle.records[0]; record.contentHash = source.contentHash;
  record.requirements[0].evidence = { field: 'description', start, end: start + raw.length, quote: raw };
  const validation = validateBundle(f.study, f.bundle); assert.equal(validation.valid, true);
  const summary = summarize(f.study, f.bundle), md = renderMarketReport(f.study, summary, validation);
  assert.ok(!md.includes('![tracker]')); assert.ok(!md.includes('[link]')); assert.ok(!md.includes('https://example.invalid')); assert.ok(!md.includes('www.example.invalid')); assert.ok(!md.includes('test@example.invalid')); assert.ok(!md.includes('`code`'));
  assert.ok(md.includes('&#33;&#91;tracker&#93;')); assert.ok(md.includes('&#96;code&#96;')); assert.ok(md.includes('&#92;'));
  assert.equal(summary.details[0].quote, raw); assert.ok(renderRequirementsCsv(summary).includes(raw));
});
test('Markdown tables retain literal GFM delimiters while data hyphens stay escaped', async t => {
  const { renderMarketReport } = await import('../../china-market.mjs');
  const { summarize } = await import('../../china/market-summary.mjs');
  const { validateBundle } = await import('../../china/market-analysis.mjs');
  const f = prepared(t), summary = summarize(f.study, f.bundle);
  const lines = renderMarketReport(f.study, summary, validateBundle(f.study, f.bundle)).split('\n');
  const headers = lines.map((line, index) => ({ line, index })).filter(({ line, index }) => line.startsWith('| ') && (index === 0 || !lines[index - 1].startsWith('| ')));
  assert.ok(headers.length >= 7);
  for (const { line, index } of headers) {
    const columns = line.split('|').length - 2;
    assert.equal(lines[index + 1], `| ${Array(columns).fill('---').join(' | ')} |`);
  }
  assert.ok(lines.some(line => line.includes('2026&#45;09&#45;10')));
});

test('new rendering can publish alongside an older report keyed only by analysis',async t=>{
 const f=prepared(t);const {fingerprint}=await import('../../china/store.mjs');
 const old=join(f.root,'reports/china-market',f.study.manifest.studyId,fingerprint(JSON.parse(readFileSync(f.file))));mkdirSync(old,{recursive:true,mode:0o700});writeFileSync(join(old,'summary.json'),'old output',{mode:0o600});
 const result=f.run(f.args);assert.equal(result.status,0,result.stderr);assert.notEqual(JSON.parse(result.stdout).reportDir,old);assert.equal(readFileSync(join(old,'summary.json'),'utf8'),'old output');
});
