import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { verifier: v } = JSON.parse(await readFile(join(root, 'toolchain.json'), 'utf8'));
if (process.platform !== 'darwin') throw new Error('This verifier bootstrap targets macOS');
for (const [tool, version] of [['colima', v.colima], ['docker', v.dockerClient]]) {
  let actual;
  try { actual = execFileSync(tool, ['--version'], { encoding: 'utf8' }); }
  catch { throw new Error(`${tool} ${version} is required; install the reviewed pinned version before rerunning setup. No unpinned Homebrew package was installed.`); }
  if (!actual.includes(version)) throw new Error(`${tool} version drift; expected ${version}. Review and update the manifest rather than silently changing tool versions.`);
}
await mkdir(v.candidateRoot, { recursive: true, mode: 0o700 });
execFileSync('colima', ['start', '--profile', v.profile, '--activate=false', '--cpus', String(v.cpus), '--memory', String(v.memoryGiB), '--disk', String(v.diskGiB), '--mount-type', 'virtiofs', '--mount', v.candidateRoot], { stdio: 'inherit' });
const profile = join(homedir(), '.colima', v.profile, 'colima.yaml');
const config = await readFile(profile, 'utf8');
await writeFile(profile, config.replace(/^autoActivate: true$/m, 'autoActivate: false'));
execFileSync('docker', ['--context', `colima-${v.profile}`, 'pull', v.image], { stdio: 'inherit' });
console.log('Dedicated verifier ready; existing Docker context preserved.');
