import { constants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, realpath, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidateGit } from './candidate-git.js';
import { parseSnapshot, writeSnapshot, type BuilderSnapshot } from './builder-snapshot.js';
import type { Options } from './process.js';

type Intent = { schemaVersion: 1; before: string; after: string; tree: string };
type TreeEntry = { mode: string; type: 'blob' | 'tree'; hash: string; name: string };
type Directory = { files: TreeEntry[]; children: Map<string, Directory> };
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const excludedRoots = new Set(['.agents', '.claude', '.codex', '.mcp.json']);
const patchLimit = 145_000_000;
const metadataLimit = 3_000_000;
const intentName = 'builder-import.json';
const manual = (detail: string) => new Error(`Builder import requires manual recovery: ${detail}; preserve the worktree and import intent`);

// Keep all host Git operations behind the existing executable-configuration
// boundary. Literal paths prevent policy prefixes becoming pathspec programs;
// replacement objects and hidden executable-mode differences are unsupported.
async function git(worktree: string, args: readonly string[], signal?: AbortSignal, options: Omit<Options, 'cwd' | 'signal'> = {}): Promise<string> {
  signal?.throwIfAborted();
  const command = [...args];
  if (['diff', 'show', 'log'].includes(command[0]!)) command.splice(1, 0, '--no-ext-diff', '--no-textconv');
  const result = await candidateGit(['--no-replace-objects', '--literal-pathspecs', '-c', 'core.fileMode=true', '-c', 'core.ignoreCase=false', ...command], {
    cwd: worktree, ...options, ...(signal ? { signal } : {}),
  });
  if (result.code !== 0 || result.interrupted) throw new Error(`Builder import git failed (${result.termination ?? result.code}): ${result.stderr.slice(0, 2000)}`);
  return result.stdout;
}

async function directory(runDir: string, worktree: string): Promise<string> {
  const info = await lstat(runDir); const root = await realpath(runDir); const candidate = await realpath(worktree);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Builder import run directory must be a real coordinator-owned directory');
  const rel = relative(candidate, root);
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) throw new Error('Builder import run directory must be outside the candidate worktree');
  return root;
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
function parseIntent(value: unknown): Intent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw manual('invalid intent');
  const record = value as Record<string, unknown>; const keys = ['schemaVersion', 'before', 'after', 'tree'];
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key)) || record.schemaVersion !== 1 ||
    [record.before, record.after, record.tree].some(hash => typeof hash !== 'string' || !oid.test(hash)) ||
    (record.before as string).length !== (record.after as string).length || (record.before as string).length !== (record.tree as string).length) throw manual('invalid intent fields');
  return record as Intent;
}
async function readIntent(runDir: string): Promise<Intent | undefined> {
  let handle;
  try { handle = await open(join(runDir, intentName), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const info = await handle.stat();
    // A crash between exclusive publication and temporary-link removal can
    // leave two links to this same immutable coordinator-owned record.
    if (!info.isFile() || info.size > 1024) throw manual('invalid intent file');
    const bytes = Buffer.alloc(1025); const count = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead;
    if (count !== info.size || count > 1024) throw manual('intent file changed or exceeds capacity');
    try { return parseIntent(JSON.parse(bytes.subarray(0, count).toString('utf8'))); }
    catch (error) { throw manual(`invalid intent: ${String(error)}`); }
  } finally { await handle.close(); }
}
async function recordIntent(runDir: string, intent: Intent): Promise<void> {
  const temporary = join(runDir, `${intentName}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(intent) + '\n'); await handle.sync(); } finally { await handle.close(); }
  try {
    // Publish atomically without replacing a concurrent or unresolved intent.
    await link(temporary, join(runDir, intentName));
  } finally { await unlink(temporary); }
  await syncDirectory(runDir);
}
async function clearIntent(runDir: string, intent: Intent): Promise<void> {
  const saved = await readIntent(runDir);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(intent)) throw manual('intent changed during reconciliation');
  await unlink(join(runDir, intentName)); await syncDirectory(runDir);
}

async function inspect(worktree: string, signal?: AbortSignal): Promise<{ head: string; tree: string }> {
  const flags = await git(worktree, ['ls-files', '-v', '-z'], signal, { maxBytes: metadataLimit });
  if (flags.split('\0').some(entry => entry && (entry[0] === 'S' || entry[0] === entry[0]!.toLowerCase()))) throw manual('unsupported index flags hide candidate changes');
  if ((await git(worktree, ['ls-files', '-z', '--', '.aegean-tmp'], signal)).length) throw manual('Builder scratch directory must not be tracked');
  const status = await git(worktree, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--ignored=matching'], signal, { maxBytes: metadataLimit });
  for (const entry of status.split('\0').filter(Boolean)) {
    const kind = entry.slice(0, 2); const path = entry.slice(3);
    if (kind === '??' || kind === '!!') {
      if (path === '.aegean-tmp' || path === '.aegean-tmp/' || path.startsWith('.aegean-tmp/')) continue;
      throw manual('worktree is not clean: untracked or ignored files exist');
    }
    if (entry[1] !== ' ' || !['A', 'M', 'D', 'T'].includes(entry[0]!)) throw manual('worktree changed relative to the index');
  }
  return { head: (await git(worktree, ['rev-parse', '--verify', 'HEAD'], signal)).trim(), tree: (await git(worktree, ['write-tree'], signal)).trim() };
}
async function cleanAt(worktree: string, expectedHead: string, signal?: AbortSignal): Promise<void> {
  const state = await inspect(worktree, signal);
  if (state.head !== expectedHead) throw manual('HEAD changed from the expected commit');
  if (state.tree !== (await git(worktree, ['rev-parse', `${expectedHead}^{tree}`], signal)).trim()) throw manual('index is not clean at the expected commit');
}
function parseTree(text: string): TreeEntry[] {
  return text.split('\0').filter(Boolean).map(record => {
    const match = /^([0-7]{6}) (blob|tree) ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/u.exec(record);
    if (!match) throw new Error('unsupported Git tree entry');
    return { mode: match[1]!, type: match[2] as TreeEntry['type'], hash: match[3]!, name: match[4]! };
  });
}
async function snapshotTree(worktree: string, before: string, snapshot: BuilderSnapshot, stage: string, signal?: AbortSignal): Promise<string> {
  await writeSnapshot(snapshot, stage); signal?.throwIfAborted();
  // Snapshot names reject control characters and backslashes. JSON quoting is
  // therefore also Git's double-quoted path syntax, including embedded quotes.
  const hashes = snapshot.files.length ? (await git(worktree, ['hash-object', '-w', '--no-filters', '--stdin-paths'], signal, {
    input: snapshot.files.map(file => JSON.stringify(join(stage, file.path))).join('\n') + '\n', maxBytes: metadataLimit,
  })).trim().split('\n') : [];
  if (hashes.length !== snapshot.files.length || hashes.some(hash => !oid.test(hash))) throw new Error('Builder snapshot blob import returned invalid identities');
  const root: Directory = { files: [], children: new Map() };
  for (const [index, file] of snapshot.files.entries()) {
    const parts = file.path.split('/'); let parent = root;
    for (const component of parts.slice(0, -1)) {
      if (!parent.children.has(component)) parent.children.set(component, { files: [], children: new Map() });
      parent = parent.children.get(component)!;
    }
    parent.files.push({ mode: file.mode === 0o755 ? '100755' : '100644', type: 'blob', hash: hashes[index]!, name: parts.at(-1)! });
  }
  root.files.push(...parseTree(await git(worktree, ['ls-tree', '-z', before], signal, { maxBytes: metadataLimit })).filter(entry => excludedRoots.has(entry.name)));
  async function build(node: Directory): Promise<string> {
    const entries = [...node.files];
    for (const [name, child] of node.children) entries.push({ mode: '040000', type: 'tree', hash: await build(child), name });
    return (await git(worktree, ['mktree', '-z'], signal, { input: entries.map(entry => `${entry.mode} ${entry.type} ${entry.hash}\t${entry.name}\0`).join('') })).trim();
  }
  return build(root);
}
async function patch(worktree: string, intent: Intent, destination: string, signal?: AbortSignal): Promise<void> {
  const handle = await open(destination, 'wx', 0o600);
  try {
    // Diff text can contain arbitrary bytes even with --binary. Git writes the
    // private file directly so the process adapter's UTF-8 stdout cannot alter it.
    await git(worktree, ['diff', '--binary', '--full-index', '--no-renames', '--no-color', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', `--output=${destination}`, intent.before, intent.after, '--'], signal, { maxBytes: 16_384 });
    if ((await handle.stat()).size > patchLimit) throw new Error('Builder import patch exceeds the 145 MB capacity limit; no patch was applied');
  } finally { await handle.close(); }
}
async function validateIntent(worktree: string, intent: Intent, signal?: AbortSignal): Promise<string> {
  let commit: string;
  try { commit = await git(worktree, ['cat-file', 'commit', intent.after], signal, { maxBytes: 16_384 }); }
  catch (error) { throw manual(`intent commit cannot be verified: ${String(error)}`); }
  const headers = commit.split('\n\n', 1)[0]!.split('\n');
  const trees = headers.filter(line => line.startsWith('tree ')); const parents = headers.filter(line => line.startsWith('parent '));
  if (trees.length !== 1 || trees[0] !== `tree ${intent.tree}` || parents.length !== 1 || parents[0] !== `parent ${intent.before}`) throw manual('intent commit parent or tree does not match');
  if ((await git(worktree, ['cat-file', '-t', intent.before], signal)).trim() !== 'commit') throw manual('intent before identity is not a commit');
  return (await git(worktree, ['rev-parse', `${intent.before}^{tree}`], signal)).trim();
}
async function finishImport(worktree: string, runDir: string, intent: Intent, signal?: AbortSignal, preparedPatch?: string): Promise<string> {
  const beforeTree = await validateIntent(worktree, intent, signal);
  let state = await inspect(worktree, signal);
  if (state.head === intent.before && state.tree === beforeTree) {
    let temporary: string | undefined;
    try {
      if (!preparedPatch) { temporary = await mkdtemp(join(runDir, 'builder-import-patch-')); preparedPatch = join(temporary, 'candidate.patch'); await patch(worktree, intent, preparedPatch, signal); }
      await git(worktree, ['apply', '--index', '--binary', '--whitespace=nowarn', '--', preparedPatch], signal, { maxBytes: 16_384 });
    } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    state = await inspect(worktree, signal);
  }
  if (state.head === intent.before && state.tree === intent.tree) {
    await git(worktree, ['update-ref', '-m', 'Aegean Builder snapshot', 'HEAD', intent.after, intent.before], signal);
    state = await inspect(worktree, signal);
  }
  if (state.head !== intent.after || state.tree !== intent.tree) throw manual('HEAD or index differs from both recorded import states');
  signal?.throwIfAborted(); await clearIntent(runDir, intent);
  return intent.after;
}
async function reconcile(worktree: string, runDir: string, intent: Intent, signal?: AbortSignal, preparedPatch?: string): Promise<string> {
  try { return await finishImport(worktree, runDir, intent, signal, preparedPatch); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('Builder import requires manual recovery:')) throw error;
    throw manual(String(error));
  }
}

/** The caller owns repository execution and has already terminated every VM writer. */
export async function importBuilderSnapshot(worktree: string, expectedHead: string, input: BuilderSnapshot, runDir: string, protectedPaths: readonly string[], signal?: AbortSignal): Promise<string> {
  const snapshot = parseSnapshot(input); signal?.throwIfAborted();
  if (!oid.test(expectedHead)) throw new Error('Builder import requires an exact expected commit');
  const root = await directory(runDir, worktree);
  if (await readIntent(root)) throw manual('an earlier import is unresolved');
  await cleanAt(worktree, expectedHead, signal);
  const stage = await mkdtemp(join(root, 'builder-import-'));
  try {
    const contents = join(stage, 'snapshot'); await mkdir(contents, { mode: 0o700 });
    const tree = await snapshotTree(worktree, expectedHead, snapshot, contents, signal);
    if (protectedPaths.length) {
      if (protectedPaths.some(path => !path || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\0\r\n]/.test(path))) throw new Error('invalid protected import path');
      const changed = await git(worktree, ['diff', '--name-only', '-z', '--no-renames', expectedHead, tree, '--', ...protectedPaths], signal, { maxBytes: metadataLimit });
      if (changed) throw new Error('Builder snapshot changes protected configuration or approved specification');
    }
    await cleanAt(worktree, expectedHead, signal);
    if (tree === (await git(worktree, ['rev-parse', `${expectedHead}^{tree}`], signal)).trim()) return expectedHead;
    const after = (await git(worktree, ['commit-tree', tree, '-p', expectedHead, '-m', 'Aegean Builder snapshot'], signal)).trim();
    const intent: Intent = { schemaVersion: 1, before: expectedHead, after, tree };
    const patchPath = join(stage, '.candidate-import.patch'); await patch(worktree, intent, patchPath, signal);
    await cleanAt(worktree, expectedHead, signal); signal?.throwIfAborted();
    await recordIntent(root, intent);
    return await reconcile(worktree, root, intent, signal, patchPath);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

/** Finish only an exact known import state; never reset or overwrite a third state. */
export async function reconcileBuilderImport(worktree: string, runDir: string, signal?: AbortSignal): Promise<string | undefined> {
  // Resume also runs before the initial worktree has been created.
  const intent = await readIntent(runDir);
  if (!intent) return undefined;
  const root = await directory(runDir, worktree);
  signal?.throwIfAborted(); return reconcile(worktree, root, intent, signal);
}
