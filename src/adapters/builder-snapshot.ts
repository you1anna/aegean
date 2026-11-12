import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type BuilderSnapshot = { schemaVersion: 1; files: Array<{ path: string; mode: 420 | 493; data: string }> };

// Keep this factory self-contained: the fixed collector embeds its compiled
// source, so host validation and VM capture use exactly the same policy.
function snapshotRules() {
  const limits = { files: 10_000, entries: 20_000, fileBytes: 5_000_000, totalBytes: 100_000_000, metadataBytes: 1_000_000, pathBytes: 4096, componentBytes: 255, depth: 64 };
  function pathKeys(path: string): string[] {
    if (typeof path !== 'string' || !path || Buffer.byteLength(path) > limits.pathBytes || /[\\\p{Cc}\p{Default_Ignorable_Code_Point}\uD800-\uDFFF]/u.test(path)) throw new Error('invalid snapshot path');
    const parts = path.split('/');
    if (parts.length > limits.depth) throw new Error('snapshot path depth exceeds capacity limit');
    const keys = parts.map(part => {
      // Compatibility normalization plus case folding is deliberately stricter
      // than either supported filesystem, including expanding folds such as ß.
      const key = part.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
      if (!part || !key || key === '.' || key === '..' || /[\\/:\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(key) || /[. ]$/.test(key) || Buffer.byteLength(part) > limits.componentBytes || Buffer.byteLength(key) > limits.componentBytes) throw new Error('invalid snapshot path component');
      if (key === '.git' || key === '.env' || key.startsWith('.env.') || ['.npmrc', '.aws', '.ssh', '.agents', '.claude', '.codex', '.mcp.json', '.aegean-tmp'].includes(key)) throw new Error('protected snapshot path');
      return key;
    });
    if (Buffer.byteLength(keys.join('/')) > limits.pathBytes) throw new Error('snapshot path exceeds capacity limit');
    return keys;
  }
  function registry() {
    const seen = new Map<string, { path: string; kind: 'file' | 'directory' }>();
    return (path: string, kind: 'file' | 'directory'): void => {
      const keys = pathKeys(path); const parts = path.split('/');
      for (let i = 0; i < keys.length; i++) {
        const key = keys.slice(0, i + 1).join('/'); const spelling = parts.slice(0, i + 1).join('/');
        const type = i === keys.length - 1 ? kind : 'directory'; const previous = seen.get(key);
        if (previous && (previous.path !== spelling || previous.kind !== type || type === 'file')) throw new Error('snapshot alias or file/directory conflict');
        if (!previous) {
          if (seen.size >= limits.entries) throw new Error('snapshot entry capacity limit exceeded');
          seen.set(key, { path: spelling, kind: type });
        }
      }
    };
  }
  function fileSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) throw new Error('snapshot file size exceeds capacity limit');
  }
  function dataSize(data: string): number {
    if (typeof data !== 'string' || data.length > Math.ceil(limits.fileBytes / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('snapshot requires bounded canonical base64');
    // Checking the final quartet also rejects nonzero padding bits without
    // allocating a decoded copy of each potentially five-megabyte input.
    const tail = data.slice(-4);
    if (Buffer.from(tail, 'base64').toString('base64') !== tail) throw new Error('snapshot requires canonical base64');
    const size = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    fileSize(size); return size;
  }
  function metadataSize(path?: string): number {
    // Include escaping, UTF-8 bytes, entry envelopes and separators. Counting a
    // final comma is conservative and avoids serializing the payload to size it.
    return Buffer.byteLength(JSON.stringify(path === undefined ? { schemaVersion: 1, files: [] } : { path, mode: 0o644, data: '' })) + (path === undefined ? 0 : 1);
  }
  function record(value: unknown, keys: string[]): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid snapshot record');
    const actual = Object.keys(value);
    if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('invalid snapshot record fields');
    return value as Record<string, unknown>;
  }
  function parse(input: unknown): BuilderSnapshot {
    const root = record(input, ['schemaVersion', 'files']);
    if (root.schemaVersion !== 1 || !Array.isArray(root.files) || root.files.length > limits.files) throw new Error('unsupported snapshot schema or file capacity limit');
    let bytes = 0; let metadata = metadataSize(); const register = registry(); const files: BuilderSnapshot['files'] = [];
    for (const raw of root.files) {
      const entry = record(raw, ['path', 'mode', 'data']);
      if (typeof entry.path !== 'string' || typeof entry.data !== 'string' || (entry.mode !== 0o644 && entry.mode !== 0o755)) throw new Error('snapshot supports only regular files and executable mode');
      register(entry.path, 'file'); bytes += dataSize(entry.data);
      if (bytes > limits.totalBytes) throw new Error('snapshot total size exceeds capacity limit');
      metadata += metadataSize(entry.path);
      if (metadata > limits.metadataBytes) throw new Error('snapshot encoded metadata exceeds capacity limit');
      files.push({ path: entry.path, mode: entry.mode, data: entry.data });
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { schemaVersion: 1, files };
  }
  return { limits, registry, fileSize, metadataSize, parse };
}

const rules = snapshotRules();
export function parseSnapshot(input: unknown): BuilderSnapshot { return rules.parse(input); }

// Called only in a separate trusted read-only collector after the supervisor
// confirms the writer is gone. This function never imports candidate code.
function captureCandidate(root: string, fs: typeof import('node:fs'), path: typeof import('node:path'), policy: ReturnType<typeof snapshotRules>): BuilderSnapshot {
  const rootInfo = fs.lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('snapshot source must be a real directory');
  const register = policy.registry(); const files: BuilderSnapshot['files'] = []; let bytes = 0; let entries = 0; let metadata = policy.metadataSize();
  function visit(directory: string, relative: string): void {
    // Latin-1 preserves filename bytes while iterating with bounded buffering;
    // reject invalid UTF-8 rather than silently replacing bytes and aliasing.
    const dir = fs.opendirSync(directory, { encoding: 'latin1', bufferSize: 1 });
    try {
      for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
        if (++entries > policy.limits.entries) throw new Error('snapshot entry capacity limit exceeded');
        const rawName = Buffer.from(entry.name, 'latin1'); const name = rawName.toString('utf8');
        if (!Buffer.from(name, 'utf8').equals(rawName)) throw new Error('snapshot filename is not valid UTF-8');
        const item = relative ? `${relative}/${name}` : name; const absolute = path.join(directory, name); const info = fs.lstatSync(absolute);
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('snapshot supports only directories and regular files');
        register(item, info.isDirectory() ? 'directory' : 'file');
        if (info.isDirectory()) { visit(absolute, item); continue; }
        if (info.nlink !== 1) throw new Error('snapshot hardlinks are unsupported');
        policy.fileSize(info.size);
        if (files.length >= policy.limits.files || bytes + info.size > policy.limits.totalBytes) throw new Error('snapshot file or total size capacity limit exceeded');
        metadata += policy.metadataSize(item);
        if (metadata > policy.limits.metadataBytes) throw new Error('snapshot encoded metadata exceeds capacity limit');
        const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const opened = fs.fstatSync(fd);
          if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new Error('snapshot source changed during capture');
          // Never let readFile allocate from a concurrently enlarged file.
          const content = Buffer.alloc(info.size); let offset = 0;
          while (offset < content.length) {
            const count = fs.readSync(fd, content, offset, content.length - offset, offset);
            if (!count) throw new Error('snapshot source changed during capture');
            offset += count;
          }
          const after = fs.fstatSync(fd);
          if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) || after.nlink !== 1 || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('snapshot source changed during capture');
          files.push({ path: item, mode: info.mode & 0o111 ? 0o755 : 0o644, data: content.toString('base64') }); bytes += info.size;
        } finally { fs.closeSync(fd); }
      }
    } finally { dir.closeSync(); }
  }
  visit(root, ''); return policy.parse({ schemaVersion: 1, files });
}

// The optional argv[1] is a trusted caller-selected fixture root. Production
// invokes the fixed program without arguments, reading only /candidate.
export const captureProgram = `'use strict';\ntry {\nconst policy = (${snapshotRules.toString()})();\nconst snapshot = (${captureCandidate.toString()})(process.argv[1] ?? '/candidate', require('node:fs'), require('node:path'), policy);\nprocess.stdout.write(JSON.stringify(snapshot));\n} catch (error) { process.stderr.write(String(error.message) + '\\n'); process.exitCode = 1; }\n`;

/**
 * Stage an untrusted snapshot in an existing empty coordinator-owned directory.
 * The coordinator must keep this directory and its ancestors out of candidate
 * reach; Node's path APIs do not provide an openat-style hostile-host boundary.
 * Partial failures leave only this disposable staging tree for caller cleanup.
 */
export async function writeSnapshot(snapshot: BuilderSnapshot, target: string): Promise<void> {
  const validated = parseSnapshot(snapshot); const initial = await lstat(target);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw new Error('snapshot target must be an existing real empty directory');
  const root = await realpath(target);
  const directories = new Map<string, { dev: number; ino: number }>([[root, initial]]);
  async function checkDirectory(directory: string): Promise<void> {
    const expected = directories.get(directory)!; const actual = await lstat(directory);
    if (!actual.isDirectory() || actual.isSymbolicLink() || actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error('snapshot target directory changed');
  }
  await checkDirectory(root);
  if ((await readdir(root)).length !== 0) throw new Error('snapshot target must be empty; existing worktrees are forbidden');
  // A fixed exclusive claim also prevents two trusted exports from populating
  // the same initially empty directory concurrently.
  const claimPath = join(root, '.aegean-tmp');
  const claim = await open(claimPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const claimInfo = await claim.stat();
  try {
    if ((await readdir(root)).some(name => name !== '.aegean-tmp')) throw new Error('snapshot target is no longer empty');
    for (const entry of validated.files) {
      const parts = entry.path.split('/'); let directory = root; await checkDirectory(root);
      for (const part of parts.slice(0, -1)) {
        const child = join(directory, part);
        if (!directories.has(child)) {
          await mkdir(child, { mode: 0o700 });
          const info = await lstat(child);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('snapshot target directory changed');
          directories.set(child, info);
        }
        directory = child; await checkDirectory(directory);
      }
      const handle = await open(join(directory, parts.at(-1)!), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1) throw new Error('snapshot target must contain exclusive regular files');
        await handle.writeFile(Buffer.from(entry.data, 'base64')); await handle.chmod(entry.mode);
      } finally { await handle.close(); }
    }
    for (const directory of directories.keys()) await checkDirectory(directory);
  } finally {
    await claim.close();
    await checkDirectory(root);
    const current = await lstat(claimPath);
    if (current.dev !== claimInfo.dev || current.ino !== claimInfo.ino || !current.isFile() || current.nlink !== 1) throw new Error('snapshot export claim changed');
    await unlink(claimPath);
  }
}
