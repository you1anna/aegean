import { mkdir, open, rename, readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../domain/digest.js';
export async function atomicJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const f = await open(temp, 'wx', 0o600);
  try { await f.writeFile(JSON.stringify(data, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
  await rename(temp, path);
  const dir = await open(dirname(path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
export async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')); }
export async function contained(root: string, path: string): Promise<string> {
  const base = await realpath(root); const target = await realpath(resolve(root, path)); const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error('path escapes workspace');
  return target;
}
export async function treeDigest(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name); const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('symlinks are not allowed in frozen artifacts');
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) files.push(`${relative(root, path)}\0${digest(await readFile(path))}`);
      else throw new Error('unsupported artifact type');
    }
  }
  await walk(root); if (!files.length) throw new Error('empty artifact tree'); return digest(files.sort().join('\n'));
}
