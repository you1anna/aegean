import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { captureProgram, parseSnapshot, writeSnapshot } from '../src/adapters/builder-snapshot.js';

const run = promisify(execFile);
const file = (path: string, data = '', mode = 0o644) => ({ path, mode, data });
const snapshot = (...files: ReturnType<typeof file>[]) => ({ schemaVersion: 1, files });
async function fixture(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'aegean-builder-snapshot-'));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function capture(root: string): Promise<unknown> {
  const result = await run(process.execPath, ['--input-type=commonjs', '--eval', captureProgram, root], { maxBuffer: 10_000_000, timeout: 10_000 });
  return JSON.parse(result.stdout);
}

test('snapshot rejects traversal, absolute paths, invalid names and protected components', () => {
  assert.throws(() => parseSnapshot(snapshot(file('.mcp.json'))), /protected/);
  for (const path of ['', '.', '..', '../outside', 'a/../../outside', '/outside', 'C:/outside', 'a\\outside', 'a\0b', 'a//b', 'a/./b', 'a/../b', 'trailing/', 'a\ud800b', 'a\nb', 'a/.git', '.GIT/config', 'a/．ｇｉｔ/config', '.g\u200cit/config', '.env', 'src/.ENV.local', '.npmrc', 'x/.aws/token', '.ssh/key', '.agents/a', '.claude/a', '.codex/a', '.aegean-tmp/a', '.git /config', '.git./config', '．/outside', 'a/＼outside']) {
    assert.throws(() => parseSnapshot(snapshot(file(path))), Error, path);
  }
  assert.throws(() => parseSnapshot(snapshot(file('a'.repeat(256)))));
  assert.throws(() => parseSnapshot(snapshot(file(Array(65).fill('a').join('/')))));
  assert.throws(() => parseSnapshot(snapshot(file(Array(40).fill('a'.repeat(110)).join('/')))));
});

test('snapshot rejects aliases, duplicate files and file/directory conflicts in either order', () => {
  for (const paths of [['a', 'a'], ['README', 'readme'], ['café', 'cafe\u0301'], ['Straße', 'STRASSE'], ['Ａ/x', 'A/y'], ['A/x', 'a/y'], ['a', 'a/b'], ['a/b', 'a'], ['a/B', 'a/b/c']]) {
    assert.throws(() => parseSnapshot(snapshot(...paths.map(path => file(path)))), Error, paths.join(', '));
  }
  assert.equal(parseSnapshot(snapshot(file('a/x'), file('a/y'))).files.length, 2);
});

test('snapshot validates schema, file kinds and canonical bounded base64 before accepting bytes', () => {
  for (const value of [null, [], {}, { schemaVersion: 2, files: [] }, { ...snapshot(), extra: true }, { schemaVersion: 1, files: [null] }, snapshot({ ...file('a'), mode: 0o120777 }), snapshot({ ...file('a'), mode: 0o600 }), snapshot({ ...file('a'), data: 1 } as never), { schemaVersion: 1, files: [{ ...file('a'), type: 'symlink' }] }]) {
    assert.throws(() => parseSnapshot(value));
  }
  for (const data of ['a', 'ab', 'abc', '====', 'YQ', 'YQ==\n', 'Y Q==', 'YQ-_', 'YR==', 'YWJ=']) assert.throws(() => parseSnapshot(snapshot(file('a', data))), Error, data);
  assert.deepEqual(parseSnapshot(snapshot(file('empty'), file('binary', 'AAEC/w=='))), snapshot(file('binary', 'AAEC/w=='), file('empty')));
  const maximum = Buffer.alloc(5_000_000).toString('base64');
  assert.equal(parseSnapshot(snapshot(file('maximum', maximum))).files[0]!.data, maximum);
  assert.equal(parseSnapshot(snapshot(...Array.from({ length: 20 }, (_, i) => file(`total-${i}`, maximum)))).files.length, 20);
  assert.throws(() => parseSnapshot(snapshot(file('oversize', Buffer.alloc(5_000_001).toString('base64')))));
  assert.throws(() => parseSnapshot(snapshot(...Array.from({ length: 21 }, (_, i) => file(`total-${i}`, maximum)))));
  assert.throws(() => parseSnapshot(snapshot(...Array.from({ length: 10_001 }, (_, i) => file(`count-${i}`)))));
  assert.throws(() => parseSnapshot(snapshot(...Array.from({ length: 6_667 }, (_, i) => file(`directory-${i}/nested/file`)))), /entry capacity/);
});

test('snapshot bounds aggregate encoded metadata including JSON escaping', () => {
  const files = Array.from({ length: 4_000 }, (_, i) => file(`${'"'.repeat(150)}/${i}`));
  assert.equal(parseSnapshot(snapshot(...files.slice(0, 2_000))).files.length, 2_000);
  assert.throws(() => parseSnapshot(snapshot(...files)), /encoded metadata/);
});

test('trusted collector and exclusive writer preserve binary bytes and executable mode', async () => fixture(async root => {
  const source = join(root, 'source'); const target = join(root, 'target');
  await mkdir(join(source, 'nested'), { recursive: true }); await mkdir(join(source, 'empty')); await mkdir(target);
  const binary = Buffer.from([0, 1, 2, 255, 128, 13, 10]);
  await writeFile(join(source, 'nested', 'bytes'), binary); await writeFile(join(source, 'run'), '#!/bin/sh\nexit 7\n'); await chmod(join(source, 'run'), 0o750);
  const captured = parseSnapshot(await capture(source));
  assert.deepEqual(captured.files.map(entry => [entry.path, entry.mode]), [['nested/bytes', 0o644], ['run', 0o755]]);
  await writeSnapshot(captured, target);
  assert.deepEqual(await readFile(join(target, 'nested', 'bytes')), binary);
  assert.equal((await lstat(join(target, 'run'))).mode & 0o777, 0o755);
  assert.equal((await lstat(join(target, 'nested', 'bytes'))).mode & 0o777, 0o644);
  assert.deepEqual(parseSnapshot(await capture(target)), captured);
}));

test('collector rejects outside symlinks, hardlinks, nested Git and protected empty directories', async () => fixture(async root => {
  const source = join(root, 'source'); await mkdir(source);
  const outside = join(root, 'outside'); await writeFile(outside, 'private sentinel');
  await symlink(outside, join(source, 'escape')); await assert.rejects(capture(source)); await rm(join(source, 'escape'));
  await symlink(source, join(root, 'alias')); await assert.rejects(capture(join(root, 'alias')));
  await link(outside, join(source, 'hard')); await assert.rejects(capture(source)); await rm(join(source, 'hard'));
  await mkdir(join(source, 'nested', '.GiT'), { recursive: true }); await assert.rejects(capture(source)); await rm(join(source, 'nested'), { recursive: true });
  await mkdir(join(source, '.aws')); await assert.rejects(capture(source));
  assert.equal(await readFile(outside, 'utf8'), 'private sentinel');
}));

test('collector rejects oversized files before reading and nonregular filesystem entries', async () => fixture(async root => {
  const source = join(root, 'source'); await mkdir(source);
  const large = join(source, 'large'); await writeFile(large, ''); await truncate(large, 5_000_001);
  await assert.rejects(capture(source), /capacity|size|limit/); await rm(large);
  await run('mkfifo', [join(source, 'fifo')]); await assert.rejects(capture(source), /regular|type/);
}));

test('collector copies candidate JavaScript without executing it', async () => fixture(async root => {
  const source = join(root, 'source'); await mkdir(source); const sentinel = join(root, 'executed');
  const program = `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed');`;
  await writeFile(join(source, 'index.js'), program); await writeFile(join(source, 'package.json'), JSON.stringify({ main: 'index.js', scripts: { preinstall: 'node index.js' } }));
  const result = parseSnapshot(await capture(source));
  assert.equal(Buffer.from(result.files.find(entry => entry.path === 'index.js')!.data, 'base64').toString('utf8'), program);
  await assert.rejects(access(sentinel));
}));

test('writer refuses nonempty, missing, symlink and existing worktree targets without overwrites', async () => fixture(async root => {
  const target = join(root, 'target'); await mkdir(target); await writeFile(join(target, 'keep'), 'existing');
  const input = parseSnapshot(snapshot(file('keep', Buffer.from('changed').toString('base64'))));
  await assert.rejects(writeSnapshot(input, target)); assert.equal(await readFile(join(target, 'keep'), 'utf8'), 'existing');
  await assert.rejects(writeSnapshot(input, join(root, 'missing')));
  await symlink(target, join(root, 'alias')); await assert.rejects(writeSnapshot(input, join(root, 'alias')));
  const worktree = join(root, 'worktree'); await mkdir(worktree); await writeFile(join(worktree, '.git'), 'gitdir: /outside');
  await assert.rejects(writeSnapshot(input, worktree)); assert.deepEqual(await readdir(worktree), ['.git']);
}));

test('writer fully validates before any write and refuses a concurrent competing export', async () => fixture(async root => {
  const target = join(root, 'target'); await mkdir(target);
  await assert.rejects(writeSnapshot(snapshot(file('valid'), file('../outside')) as never, target)); assert.deepEqual(await readdir(target), []);
  const input = parseSnapshot(snapshot(file('a/file', 'YQ==')));
  const results = await Promise.allSettled([writeSnapshot(input, target), writeSnapshot(input, target)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await readFile(join(target, 'a', 'file'), 'utf8'), 'a');
}));
