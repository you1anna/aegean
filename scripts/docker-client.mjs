import { mkdir, readFile, writeFile, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { safeParents } from './routing.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (file, args) => execFileSync(file, args, { timeout: 120000, maxBuffer: 100 * 1024 * 1024 });

// The source manifest owns versions and hashes. Never trust a Docker found on PATH.
export async function ensureDocker(user, verifier, options = {}) {
  const arch = options.arch ?? process.arch;
  const platform = options.platform ?? process.platform;
  const pin = verifier.dockerArtifacts?.[arch];
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch) || !pin) throw new Error('Unsupported Docker client platform');
  if (!/^\d+\.\d+\.\d+$/.test(verifier.dockerClient) || ![pin.archiveSha256, pin.binarySha256].every(v => /^[a-f0-9]{64}$/.test(v))) throw new Error('Invalid Docker artifact pins');
  const directory = join(user, '.local/share/aegean/host-tools', `docker-${verifier.dockerClient}-${arch}`);
  const binary = join(directory, 'docker');
  await safeParents(user, binary, true);
  const valid = async () => {
    try {
      const info = await lstat(binary);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !(info.mode & 0o111) || info.size > 100 * 1024 * 1024 || digest(await readFile(binary)) !== pin.binarySha256) throw new Error('Managed Docker client integrity mismatch; inspect and remove the damaged client before retry');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  if (await valid()) return binary;
  const lock = directory + '.lock';
  try { await mkdir(lock, {mode: 0o700}); } catch (error) { if (error.code === 'EEXIST') throw new Error(`Docker provisioning is busy or interrupted; inspect ${lock} before retry`); throw error; }
  let temporary;
  try {
    if (await valid()) return binary;
    temporary = await mkdtemp(join(directory, '.download-'));
    const archive = join(temporary, 'docker.tgz');
    const url = `https://download.docker.com/mac/static/stable/${arch === 'arm64' ? 'aarch64' : 'x86_64'}/docker-${verifier.dockerClient}.tgz`;
    if (options.download) await options.download(url, archive);
    else run('/usr/bin/curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '90', '--max-filesize', '104857600', '--output', archive, url]);
    if (digest(await readFile(archive)) !== pin.archiveSha256) throw new Error('Docker archive checksum mismatch');
    // Read only the pinned member into memory; do not unpack archive paths or links.
    const bytes = run('/usr/bin/tar', ['-xOf', archive, 'docker/docker']);
    if (digest(bytes) !== pin.binarySha256) throw new Error('Docker binary checksum mismatch');
    const staged = join(temporary, 'docker');
    await writeFile(staged, bytes, {mode: 0o755, flag: 'wx'});
    await rename(staged, binary);
    return binary;
  } finally {
    if (temporary) await rm(temporary, {recursive: true, force: true});
    await rm(lock, {recursive: true});
  }
}
