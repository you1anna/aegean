import { parseSnapshot } from '../adapters/builder-snapshot.js';
import { candidateGitChecked } from '../adapters/candidate-git.js';
import { boundedContext, type ContextPart } from '../domain/context.js';
import type { TaskScope } from '../domain/model-policy.js';
/** All reads use committed Git objects through the candidate-safe adapter. */
export async function sourceContext(repo: string, task: TaskScope, limit: number, includeOptional = true) {
  const commit = await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: repo });
  const records = (await candidateGitChecked(['ls-tree', '-rz', commit], { cwd: repo })).split('\0').filter(Boolean).map(record => { const separator = record.indexOf('\t'); return { path: record.slice(separator + 1), mode: record.slice(0, 6), object: record.slice(12, separator) }; });
  const names = records.map(record => record.path).sort();
  const metadata = new Map(records.map(record => [record.path, record]));
  const required = new Set([...task.paths, ...task.dependencies, ...names.filter(n => /(^|\/)(AGENTS|CLAUDE)\.md$|^README\.md$|^\.gitignore$/.test(n))]);
  const selected = names.filter(n => required.has(n) || includeOptional && task.class === 'unknown' && /\.(ts|js|cjs|mjs|py)$/.test(n) && !n.startsWith('test'));
  for (const path of required) if (!names.includes(path)) throw new Error(`required context missing: ${path}`);
  if (selected.length > 10000) throw new Error('source context file capacity exceeded');
  const parts: ContextPart[] = []; const omitted: string[] = []; let used = 0;
  selected.sort((a, b) => Number(required.has(b)) - Number(required.has(a)) || a.localeCompare(b, 'en'));
  for (const name of selected) {
    try {
      parseSnapshot({ schemaVersion: 1, files: [{ path: name, mode: 420, data: '' }] });
      if (!['100644', '100755'].includes(metadata.get(name)!.mode)) throw new Error('context must be a regular source file');
    } catch (error) { if (required.has(name)) throw new Error(`protected or invalid required context ${name}: ${(error as Error).message}`); omitted.push(name); continue; }
    const size = Number(await candidateGitChecked(['cat-file', '-s', `${commit}:${name}`], { cwd: repo }));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid context blob size');
    if (used + size + Buffer.byteLength(`\nFILE ${JSON.stringify(name)}\n\n`) > limit) { if (required.has(name)) throw new Error(`required context exceeds ${limit} bytes: ${name}`); omitted.push(name); continue; }
    used += size + Buffer.byteLength(`\nFILE ${JSON.stringify(name)}\n\n`);
    parts.push({ path: name, text: await candidateGitChecked(['show', `${commit}:${name}`], { cwd: repo, maxBytes: limit }), required: required.has(name) });
  }
  const result = boundedContext(parts, limit);
  return { ...result, commit, sourceObjects: selected.map(path => metadata.get(path)!), omitted: [...omitted, ...result.manifest.filter(p => !p.included).map(p => p.path)] };
}
