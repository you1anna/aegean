import { candidateGitChecked } from '../adapters/candidate-git.js';
import { join, basename, resolve } from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { checked } from '../adapters/process.js';
import { ProjectSchema, assertSupportedImage } from '../domain/config.js';
import { atomicJson } from '../adapters/files.js';
import { realpathSync, existsSync } from 'node:fs';
import { hostConfig } from './runtime.js';
import { POLICY } from '../domain/workflow.js';
export function eligible(path: string, excludedRoots?: string[]): void {
  if (!excludedRoots?.length) throw new Error('review host excludedRoots before enrolment; missing policy fails closed');
  const actual = existsSync(path) ? realpathSync(path) : resolve(path);
  const excluded = excludedRoots.map(p => existsSync(p) ? realpathSync(p) : resolve(p));
  if (excluded.some(root => root === '/' || actual === root || actual.startsWith(root + '/')) || actual === '/srv' || actual.startsWith('/srv/')) throw new Error('checkout excluded from automatic Aegean enrolment');
}
export async function enrol(repo: string, configPath: string | undefined, openspec: string, checkOnly: boolean): Promise<unknown> {
  eligible(repo, (await hostConfig()).excludedRoots);
  const gitRoot = await candidateGitChecked(['rev-parse', '--show-toplevel'], { cwd: repo });
  if (resolve(gitRoot) !== resolve(repo)) throw new Error('run enrolment from repository root');
  const target = join(repo, 'aegean.json');
  if (checkOnly) { const config = ProjectSchema.parse(JSON.parse(await readFile(target, 'utf8'))); assertSupportedImage(config); return { enrolled: true, repository: config.repository, folder: basename(repo) }; }
  if (!configPath) throw new Error('enrol requires --config with reviewed check commands and a pinned CLI verifier image');
  try { await access(target); throw new Error('repository already enrolled; update configuration through its change workflow'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const config = ProjectSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
  assertSupportedImage(config);
  await checked(openspec, ['init', '--tools', 'claude,codex', '--profile', 'core', '--no-animation', repo], { env: { ...process.env, OPENSPEC_TELEMETRY: '0' } });
  await atomicJson(target, config);
  const instructions = join(repo, 'AGENTS.md');
  const block = `\n\n<!-- aegean-project:begin -->\nSignificant changes use Aegean standard ${POLICY.version}. Read aegean.json for repository\nchecks and verifier configuration. Run \`aegean doctor --json\` and use the\ninstalled aegean skill. This supersedes direct-to-main for significant work.\nProject data and deployment restrictions remain authoritative.\n<!-- aegean-project:end -->\n`;
  let before = ''; try { before = await readFile(instructions, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  await writeFile(instructions, before + block);
  return { enrolled: true, repository: config.repository, reviewRequired: true };
}
