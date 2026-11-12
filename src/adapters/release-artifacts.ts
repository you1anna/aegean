import { createReadStream } from 'node:fs';
import { readdir, lstat, readlink, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

export async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export interface ArtifactEntry { path: string; type: 'file' | 'symlink'; mode: number; hash: string }
export async function releaseArtifacts(root: string): Promise<ArtifactEntry[]> {
  const base = await realpath(root); const entries: ArtifactEntry[] = [];
  async function walk(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const path = join(directory, name); const relativePath = relative(base, path);
      if (directory === base && ['installation.json', 'artifact-manifest.json'].includes(name)) continue;
      const info = await lstat(path);
      if (info.isDirectory()) await walk(path);
      else if (info.isSymbolicLink()) {
        const target = relative(base, await realpath(path));
        if (isAbsolute(target) || target === '..' || target.startsWith(`..${sep}`)) throw new Error('installed artifact symlink escapes release');
        entries.push({ path: relativePath, type: 'symlink', mode: info.mode & 0o777, hash: createHash('sha256').update(await readlink(path)).digest('hex') });
      } else if (info.isFile()) entries.push({ path: relativePath, type: 'file', mode: info.mode & 0o777, hash: await fileHash(path) });
      else throw new Error('unsupported installed artifact type');
    }
  }
  await walk(base);
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
