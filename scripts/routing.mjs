import { constants } from 'node:fs';
import { lstat, mkdir, open, readlink, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const begin = '<!-- aegean:begin -->'; const end = '<!-- aegean:end -->';
const capability = 'bounded-cli-v1'; const maxFile = 1_000_000;
const maxJournal = 13_000_000;
const names = { codex: '.codex/AGENTS.md', claude: '.claude/CLAUDE.md', metadata: '.local/share/aegean/routing.json' };
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const absent = () => ({ exists: false, content: '', mode: 0, hash: digest('absent') });
const present = (content, mode = 0o600) => ({ exists: true, content, mode, hash: digest(`present\0${mode}\0${content}`) });
const fail = message => new Error(`Aegean routing: ${message}`);
const same = (a, b) => a.hash === b.hash && a.exists === b.exists;

export async function routingContext(userRoot) {
  const user = await realpath(userRoot);
  return { user, data: join(user, '.local/share/aegean'), state: join(user, '.local/state/aegean') };
}
export async function safeParents(user, path, create = false) {
  const rel = relative(user, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw fail('managed path escapes the user root');
  let directory = user;
  for (const part of relative(user, dirname(path)).split(sep).filter(Boolean)) {
    directory = join(directory, part);
    let info;
    try { info = await lstat(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return;
      await mkdir(directory, { mode: 0o700 }); info = await lstat(directory);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail(`symlink or non-directory managed parent: ${directory}`);
  }
}
async function readState(context, path, maximum = maxFile) {
  await safeParents(context.user, path);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return absent(); throw fail(`cannot read regular managed file ${path}: ${error.message}`); }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum) throw fail(`managed file is not a bounded exclusive regular file: ${path}`);
    const bytes = Buffer.alloc(info.size + 1); let length = 0;
    while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
    const after = await handle.stat(); const data = bytes.subarray(0, length); const content = data.toString('utf8');
    if (length !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || !Buffer.from(content).equals(data)) throw fail(`managed file changed or is not UTF-8: ${path}`);
    return present(content, info.mode & 0o777);
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicFile(context, path, value) {
  await safeParents(context.user, path, true);
  if (!value.exists) { try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } await syncDirectory(dirname(path)); return; }
  const temporary = `${path}.${randomUUID()}.tmp`; const handle = await open(temporary, 'wx', value.mode);
  try { await handle.writeFile(value.content); await handle.chmod(value.mode); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await rm(temporary, { force: true }); }
}
async function jsonState(context, path, maximum = maxFile) {
  const state = await readState(context, path, maximum); return state.exists ? JSON.parse(state.content) : undefined;
}
function strict(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw fail(`invalid ${label}`);
}
function stateRecord(value) {
  strict(value, ['exists', 'content', 'mode', 'hash'], 'transaction file state');
  if (typeof value.exists !== 'boolean' || typeof value.content !== 'string' || Buffer.byteLength(value.content) > maxFile || !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777) throw fail('invalid transaction file state');
  const expected = value.exists ? present(value.content, value.mode) : absent();
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw fail('transaction state hash does not match');
  return value;
}
function managed(content) {
  const starts = content.split(begin).length - 1; const ends = content.split(end).length - 1;
  if (!starts && !ends) return undefined;
  if (starts !== 1 || ends !== 1 || content.indexOf(end) < content.indexOf(begin)) throw fail('malformed managed instruction block; preserve the file for manual repair');
  const start = content.indexOf(begin); const finish = content.indexOf(end) + end.length;
  return { start, finish, text: content.slice(start, finish) };
}
function metadata(value) {
  if (value === undefined) return undefined;
  strict(value, ['schemaVersion', 'host', 'release', 'identity', 'capability', 'projects', 'files', 'activatedAt'], 'activation metadata');
  strict(value.identity, ['sourceHash', 'sourceCommit', 'buildHash', 'artifactHash', 'nodeHash', 'policyIdentity', 'image'], 'activation identity');
  if (value.schemaVersion !== 1 || !uuid.test(value.host) || !isAbsolute(value.release) || value.capability !== capability || !Number.isSafeInteger(value.activatedAt) || value.activatedAt <= 0 ||
    !/^[a-f0-9]{40}$/.test(value.identity.sourceCommit) || ['sourceHash', 'buildHash', 'artifactHash', 'nodeHash', 'policyIdentity'].some(key => !hashPattern.test(value.identity[key])) || typeof value.identity.image !== 'string' ||
    !Array.isArray(value.projects) || !value.projects.length || value.projects.length > 100 || !Array.isArray(value.files) || value.files.length !== 2) throw fail('invalid activation metadata');
  for (const project of value.projects) {
    strict(project, ['repository', 'path', 'policyHash', 'policyCommit', 'capability'], 'activated project');
    if (!/^[\w.-]+\/[\w.-]+$/.test(project.repository) || !isAbsolute(project.path) || !hashPattern.test(project.policyHash) || !/^[a-f0-9]{40}$/.test(project.policyCommit) || project.capability !== capability) throw fail('invalid activated project');
  }
  for (const [index, file] of value.files.entries()) {
    strict(file, ['id', 'previousHash', 'blockHash', 'insertion'], 'activated file');
    if (file.id !== ['codex', 'claude'][index] || !hashPattern.test(file.previousHash) || !hashPattern.test(file.blockHash) || typeof file.insertion !== 'string' || file.insertion.length > 100_000 || digest(managed(file.insertion)?.text ?? '') !== file.blockHash) throw fail('invalid activated file');
  }
  return value;
}
async function snapshots(context) {
  return Object.fromEntries(await Promise.all(Object.entries(names).map(async ([id, path]) => [id, await readState(context, join(context.user, path))])));
}
function activationFrom(states) { return metadata(states.metadata.exists ? JSON.parse(states.metadata.content) : undefined); }
function assertActivationBlocks(states, active) {
  for (const file of active.files) {
    if (digest(managed(states[file.id].content)?.text ?? '') !== file.blockHash) throw fail('managed instructions differ from their activation record; use explicit migration after review');
  }
}

/** A short local mutation lock, separate from release builds and model execution. */
export async function withInstallationLock(context, action, recoverStopped = false) {
  const path = join(context.data, 'installation-lock'); await safeParents(context.user, join(path, 'owner.json'), true);
  // safeParents creates the parent lock directory, so claim a fixed exclusive
  // file rather than deleting or stealing a potentially active directory.
  const ownerPath = join(path, 'owner.json'); let owner;
  try { owner = await open(ownerPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST' || !recoverStopped) throw fail('installation/routing is locked; use --recover-routing only after the owning process has stopped');
    const recoveryPath = join(path, 'recovering');
    let claim;
    try { claim = await open(recoveryPath, 'wx', 0o600); }
    catch { throw fail('another lock recovery is active or interrupted; inspect its process before manual recovery'); }
    try {
      await claim.writeFile(JSON.stringify({ pid: process.pid })); await claim.sync();
      const saved = await jsonState(context, ownerPath, 1024);
      strict(saved, ['pid', 'token'], 'installation lock owner');
      if (!Number.isSafeInteger(saved.pid) || saved.pid <= 0 || !uuid.test(saved.token)) throw fail('invalid installation lock; manual process audit required');
      try { process.kill(saved.pid, 0); throw fail('installation lock owner is still alive'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await unlink(ownerPath);
      try { owner = await open(ownerPath, 'wx', 0o600); } catch { throw fail('another process acquired the installation lock'); }
    } finally { await claim.close(); await unlink(recoveryPath); }
  }
  const token = randomUUID();
  try {
    await owner.writeFile(JSON.stringify({ pid: process.pid, token })); await owner.sync(); await owner.close(); owner = undefined;
    return await action();
  } finally {
    await owner?.close();
    if ((await jsonState(context, ownerPath, 1024))?.token === token) await unlink(ownerPath);
  }
}

async function transaction(context, after, before, action, checkpoint) {
  const entries = Object.keys(names).map(id => ({ id, before: before[id], after: after[id] })).filter(entry => !same(entry.before, entry.after));
  if (!entries.length) return false;
  for (const entry of entries) { stateRecord(entry.before); stateRecord(entry.after); }
  const journal = { schemaVersion: 1, action, entries }; const encoded = JSON.stringify(journal) + '\n';
  if (Buffer.byteLength(encoded) > maxJournal) throw fail('routing transaction exceeds capacity');
  for (const entry of entries) {
    const backup = join(context.data, 'config-backups', `${digest(entry.id + entry.before.hash)}.json`);
    const saved = present(JSON.stringify({ id: entry.id, state: entry.before }) + '\n');
    const existing = await readState(context, backup, 2_100_000);
    if (existing.exists && existing.content !== saved.content) throw fail('configuration backup changed');
    if (!existing.exists) await atomicFile(context, backup, saved);
  }
  const path = join(context.data, 'routing-transaction.json');
  if ((await readState(context, path, maxJournal)).exists) throw fail('routing transaction requires recovery');
  await atomicFile(context, path, present(encoded));
  for (const entry of entries) {
    const target = join(context.user, names[entry.id]);
    if (!same(await readState(context, target), entry.before)) throw fail('instructions changed during routing transaction; recover without overwriting new edits');
    await atomicFile(context, target, entry.after); await checkpoint?.(entry.id);
  }
  await unlink(path); await syncDirectory(context.data); return true;
}
async function recoverTransaction(context) {
  const path = join(context.data, 'routing-transaction.json'); const journal = await jsonState(context, path, maxJournal);
  if (!journal) return false;
  strict(journal, ['schemaVersion', 'action', 'entries'], 'routing transaction');
  if (journal.schemaVersion !== 1 || !['activate', 'deactivate', 'migrate'].includes(journal.action) || !Array.isArray(journal.entries) || !journal.entries.length || journal.entries.length > 3 || new Set(journal.entries.map(entry => entry.id)).size !== journal.entries.length) throw fail('invalid routing transaction');
  const current = new Map();
  for (const entry of journal.entries) {
    strict(entry, ['id', 'before', 'after'], 'routing transaction entry');
    if (!Object.hasOwn(names, entry.id)) throw fail('unknown routing transaction path');
    stateRecord(entry.before); stateRecord(entry.after);
    const actual = await readState(context, join(context.user, names[entry.id]));
    if (!same(actual, entry.before) && !same(actual, entry.after)) throw fail('routing transaction has an unexpected third state; preserve files and backups for manual recovery');
    current.set(entry.id, actual);
  }
  // A fully observed result is complete; an interrupted multi-file result is
  // rolled back to the exact old files before accepting another explicit action.
  if (!journal.entries.every(entry => same(current.get(entry.id), entry.after))) {
    for (const entry of [...journal.entries].reverse()) if (!same(current.get(entry.id), entry.before)) {
      const target = join(context.user, names[entry.id]);
      if (!same(await readState(context, target), current.get(entry.id))) throw fail('routing file changed during recovery');
      await atomicFile(context, target, entry.before);
    }
  }
  await unlink(path); await syncDirectory(context.data); return true;
}

export async function selectedRelease(context) {
  await safeParents(context.user, join(context.data, 'current'));
  const path = join(context.data, 'current');
  if (!(await lstat(path)).isSymbolicLink()) throw fail('current release is not an installer-managed link');
  return managedRelease(context, await realpath(path));
}
export async function managedRelease(context, release) {
  await safeParents(context.user, join(release, 'installation.json'));
  const actual = await realpath(release); const parent = await realpath(join(context.data, 'releases'));
  if (dirname(actual) !== parent || !(await lstat(release)).isDirectory() || (await lstat(release)).isSymbolicLink()) throw fail('release is outside the managed release directory');
  return actual;
}
async function load(root, name) { return import(pathToFileURL(join(root, 'dist/src', name)).href); }
export async function validateInstalledRelease(root) {
  const { releaseIdentity } = await load(root, 'adapters/acceptance.js');
  return releaseIdentity(root);
}
export async function assertRoutingAllowsSelection(context, release) {
  if ((await readState(context, join(context.data, 'routing-transaction.json'), maxJournal)).exists) throw fail('unfinished routing transaction; run --recover-routing before selecting a release');
  const states = await snapshots(context); const active = activationFrom(states);
  if (active) {
    assertActivationBlocks(states, active);
    if (await selectedRelease(context) !== active.release) throw fail('selected release differs from the active routing record; explicitly deactivate before selecting a release');
    if (active.release !== release) throw fail('active routing is bound to another release; explicitly --deactivate-routing before upgrade or rollback, then accept and reactivate the selected release');
    const current = await acceptedScope(context, release, active.projects.map(project => ({ repository: project.repository, path: project.path })));
    for (const key of ['host', 'release', 'identity', 'capability', 'projects']) if (JSON.stringify(current[key]) !== JSON.stringify(active[key])) throw fail('active routing identity or project policy changed; explicitly deactivate and review before reactivation');
  }
  return { migrationRequired: !active && ['codex', 'claude'].some(id => Boolean(managed(states[id].content))), routingActive: Boolean(active) };
}
async function acceptedScope(context, root, requests) {
  if (!requests.length || requests.length > 100) throw fail('activation requires 1–100 explicit project names and reviewed local project paths');
  const [{ acceptedRelease }, { HostSchema }, { ProjectSchema, assertSupportedImage }, { eligible }, { candidateGitChecked }] = await Promise.all([
    load(root, 'adapters/acceptance.js'), load(root, 'application/runtime.js'), load(root, 'domain/config.js'), load(root, 'application/enrol.js'), load(root, 'adapters/candidate-git.js'),
  ]);
  const host = HostSchema.parse(await jsonState(context, join(context.state, 'settings.json'), 65_536));
  const accepted = await acceptedRelease(root, context.state, undefined, host.host);
  if (accepted.host !== host.host || accepted.capability !== capability) throw fail('current host lacks bounded-cli-v1 acceptance');
  const projects = [];
  for (const request of requests) {
    if (!request || !/^[\w.-]+\/[\w.-]+$/.test(request.repository) || typeof request.path !== 'string') throw fail('invalid scoped project');
    const path = await realpath(resolve(request.path)); eligible(path, host.excludedRoots);
    const git = args => candidateGitChecked(args, { cwd: path });
    if (await realpath(await git(['rev-parse', '--show-toplevel'])) !== path) throw fail('project path must be its Git repository root');
    const origin = await git(['remote', 'get-url', 'origin']);
    const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin);
    if (!match || match[1] !== request.repository) throw fail('project name differs from its configured GitHub origin');
    const info = await lstat(join(path, 'aegean.json'));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65_536) throw fail('project policy must be a bounded regular file');
    if (await git(['status', '--porcelain', '--', 'aegean.json'])) throw fail('project policy must be committed and unchanged before routing activation');
    const policy = await git(['show', 'HEAD:aegean.json']);
    const handle = await open(join(path, 'aegean.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = Buffer.alloc(65_537); const count = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead;
      if (count > 65_536 || bytes.subarray(0, count).toString('utf8').trim() !== policy) throw fail('working project policy differs from its committed content');
    } finally { await handle.close(); }
    const project = ProjectSchema.parse(JSON.parse(policy)); assertSupportedImage(project);
    if (project.repository !== request.repository || project.verifier.kind !== 'cli') throw fail('project policy does not match the supported bounded CLI repository');
    projects.push({ repository: request.repository, path, policyHash: digest(policy), policyCommit: await git(['log', '-1', '--format=%H', '--', 'aegean.json']), capability });
  }
  projects.sort((a, b) => a.repository.localeCompare(b.repository));
  if (new Set(projects.map(project => project.repository)).size !== projects.length || new Set(projects.map(project => project.path)).size !== projects.length) throw fail('duplicate activated project');
  const { sourceHash, sourceCommit, buildHash, artifactHash, nodeHash, policyIdentity, image } = accepted;
  return { host: host.host, release: root, identity: { sourceHash, sourceCommit, buildHash, artifactHash, nodeHash, policyIdentity, image }, capability, projects };
}
async function block(context, root, scope) {
  const policy = await readState(context, join(root, 'policy/ROUTING.md'), 65_536);
  if (!policy.exists || managed(policy.content)) throw fail('installed routing policy is missing or contains managed delimiters');
  const text = `${begin}\n## Aegean routing — explicitly activated scope\n\nHost: ${scope.host}\nCapability: ${capability}\nRelease: ${scope.identity.sourceCommit}\nPolicy: ${scope.identity.policyIdentity}\n\nActivated repositories (only these exact local checkouts):\n${scope.projects.map(project => `- ${project.repository}: ${JSON.stringify(project.path)} (policy ${project.policyHash})`).join('\n')}\n\n${policy.content.trim()}\n${end}`;
  managed(text); return text;
}

/** Only explicit routing actions call this; ordinary installation never does. */
export async function routingAction(userRoot, action, projects = [], options = {}) {
  if (!['activate', 'deactivate', 'migrate', 'recover'].includes(action)) throw fail('unsupported routing action');
  const context = await routingContext(userRoot);
  return withInstallationLock(context, async () => {
    const recovered = await recoverTransaction(context);
    if (action === 'recover') return { recovered };
    const before = await snapshots(context); const after = { ...before }; const active = activationFrom(before);
    if (active && action !== 'migrate') assertActivationBlocks(before, active);
    if (action === 'activate') {
      if (!active && ['codex', 'claude'].some(id => managed(before[id].content))) throw fail('legacy mandatory routing requires explicit --migrate-routing before scoped activation');
      const root = await selectedRelease(context); const scope = await acceptedScope(context, root, projects);
      const text = await block(context, root, scope); const files = [];
      for (const id of ['codex', 'claude']) {
        const old = before[id]; const found = managed(old.content); const insertion = `\n${text}\n`;
        const content = found ? old.content.slice(0, found.start) + text + old.content.slice(found.finish) : old.content + insertion;
        after[id] = present(content, old.exists ? old.mode : 0o600);
        files.push({ id, previousHash: active?.files.find(file => file.id === id)?.previousHash ?? old.hash, blockHash: digest(text), insertion });
      }
      const record = { schemaVersion: 1, ...scope, files, activatedAt: active?.activatedAt ?? Date.now() };
      after.metadata = present(JSON.stringify(record, null, 2) + '\n');
    } else {
      if (action === 'deactivate' && !active && ['codex', 'claude'].some(id => managed(before[id].content))) throw fail('legacy routing requires explicit --migrate-routing');
      for (const id of ['codex', 'claude']) {
        const old = before[id]; const found = managed(old.content); if (!found) continue;
        const insertion = active?.files.find(file => file.id === id)?.insertion;
        const content = insertion && old.content.includes(insertion) ? old.content.replace(insertion, '') : old.content.slice(0, found.start) + old.content.slice(found.finish);
        after[id] = content === '' && active?.files.find(file => file.id === id)?.previousHash === absent().hash ? absent() : present(content, old.mode);
      }
      after.metadata = absent();
    }
    const changed = await transaction(context, after, before, action, options.checkpoint);
    return { action, changed, recovered, active: action === 'activate' };
  }, action === 'recover');
}
