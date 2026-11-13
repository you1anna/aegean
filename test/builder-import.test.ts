import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { candidateGitChecked } from '../src/adapters/candidate-git.js';
import { checked } from '../src/adapters/process.js';
import { importBuilderSnapshot, reconcileBuilderImport } from '../src/adapters/builder-import.js';
import { parseSnapshot, type BuilderSnapshot } from '../src/adapters/builder-snapshot.js';
import { isolateGitConfig } from './helpers/git-config.js';

isolateGitConfig();

const protectedPaths = ['aegean.json', 'openspec/changes/frozen'];
const entry = (path: string, data: string | Buffer, mode: 420 | 493 = 0o644) => ({ path, data: Buffer.from(data).toString('base64'), mode });
const snapshot = (...files: BuilderSnapshot['files']) => parseSnapshot({ schemaVersion: 1, files });
type Fixture = { root: string; repo: string; runDir: string; before: string; git: (args: string[], input?: string) => Promise<string>; base: BuilderSnapshot['files'] };
async function fixture(body: (value: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'aegean-builder-import-')); const repo = join(root, 'repo'); const runDir = join(root, 'run');
  await mkdir(repo); await mkdir(runDir);
  const git = (args: string[], input?: string) => candidateGitChecked(args, { cwd: repo, ...(input === undefined ? {} : { input }) });
  try {
    await checked('git', ['init', '-b', 'main'], { cwd: repo }); await git(['config', 'user.name', 'Test']); await git(['config', 'user.email', 'test@localhost']);
    const base = [entry('aegean.json', '{"policy":"frozen"}\n'), entry('openspec/changes/frozen/spec.md', 'approved\n'), entry('.gitignore', 'ignored.bin\n'), entry('keep.txt', 'original\n'), entry('binary.bin', Buffer.from([0, 1, 2, 255])), entry('delete.txt', 'delete me\n')];
    for (const file of [...base, entry('.agents/policy', 'trusted instructions\n'), entry('.claude/settings.json', '{}\n'), entry('.codex/config.toml', 'trusted = true\n'), entry('.mcp.json', '{}\n')]) {
      await mkdir(dirname(join(repo, file.path)), { recursive: true }); await writeFile(join(repo, file.path), Buffer.from(file.data, 'base64'));
    }
    await git(['add', '--all']); await git(['commit', '-m', 'seed']); const before = await git(['rev-parse', 'HEAD']);
    await body({ root, repo, runDir, before, git, base });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function intent(f: Fixture): Promise<{ before: string; after: string; tree: string }> {
  // Simulate the durable checkpoint left before apply, or after a lost response.
  const blob = await f.git(['hash-object', '-w', '--stdin'], 'recovered\n');
  const oldTree = await f.git(['ls-tree', '-z', f.before]);
  const records = oldTree.split('\0').filter(Boolean).map(line => line.endsWith('\tkeep.txt') ? `100644 blob ${blob}\tkeep.txt` : line);
  const tree = await f.git(['mktree', '-z'], records.join('\0') + '\0');
  const after = await f.git(['commit-tree', tree, '-p', f.before, '-m', 'Aegean Builder snapshot']);
  await writeFile(join(f.runDir, 'builder-import.json'), JSON.stringify({ schemaVersion: 1, before: f.before, after, tree }));
  return { before: f.before, after, tree };
}
async function applyIntent(f: Fixture, state: Awaited<ReturnType<typeof intent>>): Promise<void> {
  const patch = join(f.runDir, 'fixture.patch');
  await writeFile(patch, (await f.git(['diff', '--binary', '--full-index', '--no-renames', state.before, state.after])) + '\n');
  await f.git(['apply', '--index', '--binary', '--whitespace=nowarn', '--', patch]);
}

test('snapshot import preserves binary bytes, modes, deletions, ignored additions and excluded configuration', async () => fixture(async f => {
  const binary = Buffer.from([0, 255, 128, 1, 13, 10]);
  const preserved = await f.git(['ls-tree', '-z', f.before, '--', '.agents', '.claude', '.codex', '.mcp.json']);
  await mkdir(join(f.repo, '.aegean-tmp')); await writeFile(join(f.repo, '.aegean-tmp', 'scratch'), 'scratch');
  const after = await importBuilderSnapshot(f.repo, f.before, snapshot(...f.base.filter(x => !['delete.txt', 'keep.txt', 'binary.bin'].includes(x.path)), entry('keep.txt', 'changed\n', 0o755), entry('binary.bin', binary), entry('ignored.bin', binary), entry('scripts/run', '#!/bin/sh\nexit 0\n', 0o755), entry('space and "quote".txt', 'quoted\n')), f.runDir, protectedPaths);
  assert.equal(await f.git(['rev-parse', 'HEAD']), after); assert.notEqual(after, f.before);
  assert.equal(await f.git(['rev-parse', `${after}^`]), f.before);
  assert.deepEqual(await readFile(join(f.repo, 'ignored.bin')), binary);
  assert.deepEqual(await readFile(join(f.repo, 'binary.bin')), binary);
  assert.equal((await stat(join(f.repo, 'keep.txt'))).mode & 0o777, 0o755);
  assert.equal((await stat(join(f.repo, 'scripts/run'))).mode & 0o777, 0o755);
  await assert.rejects(access(join(f.repo, 'delete.txt')));
  assert.equal(await f.git(['ls-tree', '-z', after, '--', '.agents', '.claude', '.codex', '.mcp.json']), preserved);
  assert.equal(await f.git(['rev-parse', 'HEAD:ignored.bin']), await f.git(['hash-object', '--no-filters', '--', join(f.repo, 'ignored.bin')]));
  assert.equal(await readFile(join(f.repo, 'space and "quote".txt'), 'utf8'), 'quoted\n');
  await assert.rejects(access(join(f.runDir, 'builder-import.json')));
  assert.equal(await reconcileBuilderImport(f.repo, f.runDir), undefined);
}));

test('unchanged snapshots retain the existing commit', async () => fixture(async f => {
  assert.equal(await importBuilderSnapshot(f.repo, f.before, snapshot(...f.base), f.runDir, protectedPaths), f.before);
  await assert.rejects(access(join(f.runDir, 'builder-import.json')));
}));

test('reconciliation without an intent does not require an existing worktree', async () => fixture(async f => {
  assert.equal(await reconcileBuilderImport(join(f.root, 'not-created-yet'), f.runDir), undefined);
}));

test('concurrent imports cannot replace an unresolved intent or apply two candidates', async () => fixture(async f => {
  const candidate = snapshot(...f.base, entry('new.txt', 'new\n'));
  const results = await Promise.allSettled([importBuilderSnapshot(f.repo, f.before, candidate, f.runDir, protectedPaths), importBuilderSnapshot(f.repo, f.before, candidate, f.runDir, protectedPaths)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = results.find(result => result.status === 'fulfilled'); assert.ok(winner?.status === 'fulfilled');
  assert.equal(await f.git(['rev-parse', 'HEAD']), winner.value); assert.equal(await f.git(['status', '--porcelain']), '');
  await assert.rejects(access(join(f.runDir, 'builder-import.json')));
}));

test('snapshot import preserves non-UTF8 text bytes without a NUL binary heuristic', async () => fixture(async f => {
  const bytes = Buffer.from([0xff, 0x61, 0xfe, 0x0a]);
  await importBuilderSnapshot(f.repo, f.before, snapshot(...f.base, entry('latin.txt', bytes)), f.runDir, protectedPaths);
  assert.deepEqual(await readFile(join(f.repo, 'latin.txt')), bytes);
}));

test('protected policy and approved contract changes fail before worktree or HEAD effects', async () => fixture(async f => {
  for (const path of protectedPaths) {
    const candidate = f.base.filter(x => x.path !== path && !x.path.startsWith(`${path}/`));
    candidate.push(entry(path === 'aegean.json' ? path : `${path}/spec.md`, 'tampered\n'));
    await assert.rejects(importBuilderSnapshot(f.repo, f.before, snapshot(...candidate), f.runDir, protectedPaths), /protected/);
    assert.equal(await f.git(['rev-parse', 'HEAD']), f.before); assert.equal(await f.git(['status', '--porcelain']), '');
    await assert.rejects(access(join(f.runDir, 'builder-import.json')));
  }
}));

test('unsafe snapshot paths are rejected before repository effects', async () => fixture(async f => {
  for (const path of ['../outside', '.git/config', '.agents/policy', '.mcp.json', 'a/../../outside']) {
    await assert.rejects(importBuilderSnapshot(f.repo, f.before, { schemaVersion: 1, files: [entry(path, 'unsafe')] }, f.runDir, protectedPaths));
  }
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.before); assert.equal(await f.git(['status', '--porcelain']), '');
}));

test('stale HEAD and dirty tracked, staged, untracked, ignored or concealed files are preserved', async () => fixture(async f => {
  const next = snapshot(...f.base.filter(x => x.path !== 'keep.txt'), entry('keep.txt', 'candidate\n'));
  await assert.rejects(importBuilderSnapshot(f.repo, '0'.repeat(40), next, f.runDir, protectedPaths), /HEAD|commit/);
  await writeFile(join(f.repo, 'keep.txt'), 'human edit\n');
  await assert.rejects(importBuilderSnapshot(f.repo, f.before, next, f.runDir, protectedPaths), /clean|changed|dirty/);
  assert.equal(await readFile(join(f.repo, 'keep.txt'), 'utf8'), 'human edit\n');
  await f.git(['add', 'keep.txt']); await assert.rejects(importBuilderSnapshot(f.repo, f.before, next, f.runDir, protectedPaths), /clean|index/);
  await f.git(['reset', '--hard', f.before]);
  for (const name of ['untracked.txt', 'ignored.bin']) {
    await writeFile(join(f.repo, name), 'human file\n');
    await assert.rejects(importBuilderSnapshot(f.repo, f.before, next, f.runDir, protectedPaths), /clean|untracked|ignored/);
    assert.equal(await readFile(join(f.repo, name), 'utf8'), 'human file\n'); await rm(join(f.repo, name));
  }
  await f.git(['update-index', '--assume-unchanged', 'keep.txt']);
  await assert.rejects(importBuilderSnapshot(f.repo, f.before, next, f.runDir, protectedPaths), /index flags/);
  await f.git(['update-index', '--no-assume-unchanged', 'keep.txt']);
  await f.git(['update-index', '--skip-worktree', 'keep.txt']);
  await assert.rejects(importBuilderSnapshot(f.repo, f.before, next, f.runDir, protectedPaths), /index flags/);
}));

test('recovery completes each exact pre-apply, applied and HEAD-updated state idempotently', async () => {
  for (const stage of ['prepared', 'applied', 'updated']) await fixture(async f => {
    const state = await intent(f);
    if (stage !== 'prepared') await applyIntent(f, state);
    if (stage === 'updated') await f.git(['update-ref', 'HEAD', state.after, state.before]);
    assert.equal(await reconcileBuilderImport(f.repo, f.runDir), state.after);
    assert.equal(await f.git(['rev-parse', 'HEAD']), state.after); assert.equal(await f.git(['status', '--porcelain']), '');
    assert.equal(await readFile(join(f.repo, 'keep.txt'), 'utf8'), 'recovered\n');
    assert.equal(await reconcileBuilderImport(f.repo, f.runDir), undefined);
  });
});

test('recovery preserves third-state files, index and HEAD and retains the intent', async () => {
  for (const stage of ['worktree', 'index', 'head']) await fixture(async f => {
    const state = await intent(f);
    await writeFile(join(f.repo, 'keep.txt'), 'third state\n');
    if (stage !== 'worktree') await f.git(['add', 'keep.txt']);
    if (stage === 'head') await f.git(['commit', '-m', 'human edit']);
    const head = await f.git(['rev-parse', 'HEAD']); const index = await f.git(['write-tree']);
    await assert.rejects(reconcileBuilderImport(f.repo, f.runDir), /manual recovery/);
    assert.equal(await f.git(['rev-parse', 'HEAD']), head); assert.equal(await f.git(['write-tree']), index);
    assert.equal(await readFile(join(f.repo, 'keep.txt'), 'utf8'), 'third state\n');
    assert.equal(JSON.parse(await readFile(join(f.runDir, 'builder-import.json'), 'utf8')).after, state.after);
  });
});

test('recovery rejects malformed, extra-field and inconsistent commit intents without effects', async () => fixture(async f => {
  const state = await intent(f);
  for (const value of [{ schemaVersion: 1, ...state, patch: '/outside' }, { schemaVersion: 1, ...state, before: state.after }, { schemaVersion: 1, ...state, tree: f.before }, { schemaVersion: 1, ...state, after: state.tree }, { schemaVersion: 2, ...state }]) {
    await writeFile(join(f.runDir, 'builder-import.json'), JSON.stringify(value));
    await assert.rejects(reconcileBuilderImport(f.repo, f.runDir), /intent|commit|manual recovery/);
    assert.equal(await f.git(['rev-parse', 'HEAD']), f.before); assert.equal(await f.git(['status', '--porcelain']), '');
  }
}));

test('aborted recovery keeps the exact intent for a later successful reconciliation', async () => fixture(async f => {
  const state = await intent(f); const controller = new AbortController(); controller.abort();
  await assert.rejects(reconcileBuilderImport(f.repo, f.runDir, controller.signal));
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.before); await access(join(f.runDir, 'builder-import.json'));
  assert.equal(await reconcileBuilderImport(f.repo, f.runDir), state.after);
}));

test('patch capacity rejection happens before intent, index or worktree changes', async () => fixture(async f => {
  const original = Buffer.alloc(4_000_000, 'a'); const replacement = Buffer.alloc(4_000_000, 'b').toString('base64');
  const additions: BuilderSnapshot['files'] = [];
  for (let i = 0; i < 20; i++) {
    const path = `capacity-${i}.txt`; await writeFile(join(f.repo, path), original);
    additions.push({ path, mode: 0o644, data: replacement });
  }
  await f.git(['add', '--all']); await f.git(['commit', '-m', 'bounded original files']); const before = await f.git(['rev-parse', 'HEAD']);
  await assert.rejects(importBuilderSnapshot(f.repo, before, snapshot(...f.base, ...additions), f.runDir, protectedPaths), /145 MB capacity/);
  assert.equal(await f.git(['rev-parse', 'HEAD']), before); assert.equal(await f.git(['status', '--porcelain']), '');
  assert.deepEqual(await readFile(join(f.repo, 'capacity-0.txt')), original);
  await assert.rejects(access(join(f.runDir, 'builder-import.json')));
}));

test('candidate hooks and attributes cannot cause host code execution during import', async () => fixture(async f => {
  const sentinel = join(f.root, 'executed');
  for (const hook of ['pre-commit', 'post-commit', 'post-checkout', 'post-merge', 'reference-transaction']) {
    const path = join(f.repo, '.git', 'hooks', hook); await writeFile(path, `#!/bin/sh\nprintf executed > '${sentinel}'\n`); await chmod(path, 0o755);
  }
  const candidate = snapshot(...f.base, entry('.gitattributes', '*.txt filter=arbitrary diff=arbitrary\n'), entry('program.js', `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed');\n`));
  await importBuilderSnapshot(f.repo, f.before, candidate, f.runDir, protectedPaths); await assert.rejects(access(sentinel));
  // Even if configuration already names a helper, it must be refused before use.
  await checked('git', ['config', 'filter.arbitrary.clean', `sh -c 'touch ${sentinel}'`], { cwd: f.repo });
  await assert.rejects(importBuilderSnapshot(f.repo, await checked('git', ['rev-parse', 'HEAD'], { cwd: f.repo }), candidate, f.runDir, protectedPaths), /unsupported executable Git/);
  await assert.rejects(access(sentinel));
}));
