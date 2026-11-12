import { realpath, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { checked, command, type Options, type Result } from './process.js';

// Git is a host process, not part of the Builder sandbox. Never let candidate
// content select hooks, filters, textconv, signing, maintenance or config code.
const inert = ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'submodule.recurse=false', '-c', 'diff.ignoreSubmodules=all'];
function environment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_(CONFIG|CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)|EXTERNAL_DIFF|DIFF_OPTS|SSH|SSH_COMMAND|ASKPASS|EXEC_PATH|TEMPLATE_DIR|DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/.test(key)));
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
export async function assertCandidateGit(repo: string, env = environment(process.env)): Promise<void> {
  const root = await realpath(repo);
  let entriesSeen = 0;
  async function rejectNestedGit(directory: string, depth: number): Promise<void> {
    if (depth > 64) throw new Error('candidate directory nesting exceeds supported capacity');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === '.git') continue;
      if (++entriesSeen > 20000) throw new Error('candidate workspace exceeds supported entry count');
      if (entry.name.toLowerCase() === '.git') throw new Error('nested Git metadata is unsupported in candidate workspaces');
      if (entry.isDirectory()) {
        const child = await realpath(resolve(directory, entry.name));
        if (!inside(root, child)) throw new Error('candidate directory escapes workspace');
        await rejectNestedGit(child, depth + 1);
      }
    }
  }
  await rejectNestedGit(root, 0);
  const index = await checked('git', [...inert, 'ls-files', '--stage', '-z'], { cwd: repo, env });
  if (index.split('\0').some(entry => entry.startsWith('160000 '))) throw new Error('Git submodules/gitlinks are unsupported in candidate workspaces');
  // .git is denied to Builder. A linked worktree's real metadata is outside
  // this root; a normal checkout's metadata remains beneath this protected path.
  const gitDir = resolve(root, '.git');
  const config = await checked('git', [...inert, 'config', '--null', '--show-origin', '--list'], { cwd: repo, env });
  const entries = config.split('\0');
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const origin = entries[i]!; const entry = entries[i + 1]!; const newline = entry.indexOf('\n');
    const key = (newline < 0 ? entry : entry.slice(0, newline)).toLowerCase(); const value = newline < 0 ? '' : entry.slice(newline + 1);
    if (origin.startsWith('file:')) {
      const path = await realpath(resolve(repo, origin.slice(5)));
      if (inside(root, path) && !inside(gitDir, path)) throw new Error('candidate-controlled Git config include is unsupported');
    }
    if (value && /^(filter\..+\.(clean|smudge|process)|diff\..+\.(command|textconv)|core\.(sshcommand|gitproxy|askpass))$/.test(key)) throw new Error(`unsupported executable Git configuration: ${key}`);
    if (value && /^credential(?:\..+)?\.helper$/.test(key) && !['osxkeychain', 'cache', 'store'].includes(value)) {
      // The supported host gh helper has fixed arguments and an absolute,
      // non-candidate executable. Arbitrary shell helpers fail closed.
      const match = /^!\s*(\/[-\w./]+\/gh) auth git-credential$/.exec(value);
      if (!match || inside(root, await realpath(match[1]!))) throw new Error('unsupported Git credential helper; use a reviewed host helper');
    }
  }
}
export async function candidateGit(args: readonly string[], options: Options & { cwd: string }): Promise<Result> {
  const env = environment(options.env ?? process.env);
  await assertCandidateGit(options.cwd, env);
  const commandArgs = [...args];
  if (['diff', 'show', 'log'].includes(commandArgs[0]!)) commandArgs.splice(1, 0, '--no-ext-diff', '--no-textconv');
  return command('git', [...inert, ...commandArgs], { ...options, env });
}
export async function candidateGitChecked(args: readonly string[], options: Options & { cwd: string }): Promise<string> {
  const result = await candidateGit(args, options);
  if (result.code !== 0 || result.interrupted) throw new Error(`git failed (${result.termination ?? result.code}): ${result.stderr.slice(0, 2000)}`);
  return result.stdout.trim();
}
