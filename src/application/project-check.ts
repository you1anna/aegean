import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectSchema, assertSupportedImage, assertVerifierEntryPoint } from '../domain/config.js';
import { candidateGit, candidateGitChecked } from '../adapters/candidate-git.js';
import { eligible } from './enrol.js';
import { hostConfig } from './runtime.js';
import { digest } from '../domain/digest.js';
import type { Project } from '../domain/config.js';
import { scoutContext } from './model-context.js';
export async function checkProject(repo: string, signal?: AbortSignal) {
  repo = await realpath(repo);
  eligible(repo, (await hostConfig()).excludedRoots);
  const parsed = ProjectSchema.safeParse(JSON.parse(await readFile(join(repo,'aegean.json'),'utf8')));
  if (!parsed.success) throw new Error(`Review aegean.json before a run: ${parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}. See OPERATIONS configuration examples.`);
  const project = parsed.data;
  if (!project.modelExecution) throw new Error('modelExecution requires an explicit token budget and task scope before start');
  if(project.modelExecution.budget.enforcement !== 'monitored') throw new Error('strict token caps are unsupported; review modelExecution.budget');
  assertSupportedImage(project); assertVerifierEntryPoint(project);
  const opts = { cwd: repo, ...(signal ? {signal} : {}) };
  if (await candidateGitChecked(['rev-parse','--show-toplevel'],opts) !== repo) throw new Error('run from repository root');
  if (await candidateGitChecked(['status','--porcelain'],opts)) throw new Error('commit or preserve current work before starting an isolated run');
  const remote = await candidateGitChecked(['remote','get-url','origin'],opts);
  const identity = remote.replace(/^git@github\.com:/,'').replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'');
  if (identity !== project.repository) throw new Error('repository identity differs from reviewed configuration');
  const base = await candidateGitChecked(['rev-parse','HEAD'],opts);
  const remoteBase = (await candidateGitChecked(['ls-remote','origin','refs/heads/main'],opts)).split(/\s/)[0];
  if (base !== remoteBase) throw new Error('start from the reviewed remote main revision');
  const committedResult = await candidateGit(['show',`${base}:aegean.json`],opts);
  if(committedResult.code!==0||committedResult.interrupted)throw new Error('cannot read committed project policy');
  const committed = committedResult.stdout;
  // Image identity is established; executable availability needs native verification.
  return { repo, project, base, projectPolicy: digest(committed), verifierCompatibility: 'image accepted; executable and dependency availability require protected verification' };
}
/** Lists the committed files that the Scout receives. No model call; no file text in the result. */
export async function agentContext(repo: string, project: Project) {
  const { source, limit: limitBytes } = await scoutContext(repo, project, '');
  return {
    files: source.manifest.filter(part => part.included).map(part => ({ path: part.path, bytes: part.bytes, required: part.required })),
    omitted: source.omitted, bytes: source.bytes, limitBytes,
    note: 'The Scout reads only these committed files, the request and the project checks. The request and the instructions also count towards the limit. To add a file, commit it and add its path to modelExecution.task.paths in aegean.json.',
  };
}
