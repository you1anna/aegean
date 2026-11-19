import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicJson } from '../adapters/files.js';
import { GitLedger } from '../adapters/ledger.js';
import { command } from '../adapters/process.js';
import { authenticatedApprover, resolveApprover } from '../adapters/github.js';
import { assertDecision, confirmHumanDecision } from '../adapters/human-decision.js';
import { identityKeys, releaseIdentity } from '../adapters/acceptance-evidence.js';
import { executionLock } from '../adapters/run-lock.js';
import { digest } from '../domain/digest.js';
import { GitHubLogin } from '../domain/config.js';
import { hostConfig, stateRoot } from './runtime.js';

interface MigrationEdges {
  host: typeof hostConfig;
  state: typeof stateRoot;
  identity: typeof releaseIdentity;
  resolveApprover: typeof resolveApprover;
  authenticate: typeof authenticatedApprover;
  confirm: typeof confirmHumanDecision;
  ledger: (remote: string, signal: AbortSignal) => Pick<GitLedger, 'inspectMigration' | 'migrateQuiescent'>;
}
async function decisionDirectory(state: string): Promise<string> {
  const canonical = resolve(state); const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(canonical) !== canonical || (info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('control migration state must be a private coordinator-owned directory');
  const path = join(canonical, 'control-migrations'); await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const directory = await lstat(path);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(path) !== path || (directory.mode & 0o077) !== 0) throw new Error('control migration decision directory must be private and must not be a symlink');
  return path;
}

/** Trusted edge injection for synthetic tests; the CLI uses the fixed edges below. */
export function migrationCoordinator(edges: MigrationEdges) {
  return async (root: string, approverLogin: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    // Host configuration has no migration approver. Naming this human is an
    // explicit operator decision; neither repository nor organisation owners
    // are inferred, and an organisation/bot cannot resolve as a human account.
    const expected = await edges.resolveApprover(GitHubLogin.parse(approverLogin), signal);
    const host = await edges.host(); const identity = await edges.identity(root);
    const ledger = edges.ledger(host.controlRemote, signal); const before = await ledger.inspectMigration();
    if (before.schemaVersion === 2) return { migrated: false, schemaVersion: 2 as const, revision: before.revision, controlCommit: before.commit };
    const artifact = { schemaVersion: 1, kind: 'control-migration', host: host.host, remote: host.controlRemote, before, release: identity, approver: expected, targetSchemaVersion: 2 };
    const id = `control-${digest(host.controlRemote).slice(0, 24)}`;
    const summary = `Migrate the control ledger from schema 1 to schema 2.\nHost: ${host.host}\nControl remote: ${host.controlRemote}\nReviewed control commit: ${before.commit}\nRevision: ${before.revision}\nTerminal historical runs preserved: ${before.terminalRuns}\nThe reviewed legacy ledger has no owner or active run. No run is resumed, adopted or reapproved.\nInstalled source: ${identity.sourceCommit}\nPolicy identity: ${identity.policyIdentity}\nOnly the exact reviewed control commit may be migrated. Its history remains recoverable in Git. Older clients will refuse the new schema.`;
    const decision = await edges.confirm('migrate-control', id, summary, artifact, expected, () => edges.authenticate(expected, signal), signal);
    assertDecision(decision, 'migrate-control', id, artifact, expected);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(decision.id)) throw new Error('invalid control migration decision identity');
    signal.throwIfAborted();
    // Never hold a local mutation lock during a human wait. Cross-host races
    // are fenced by the exact reviewed Git parent and non-force push.
    const directory = await decisionDirectory(edges.state()); const release = await executionLock(directory);
    try {
      const currentHost = await edges.host(); const currentIdentity = await edges.identity(root);
      if (currentHost.host !== host.host || currentHost.controlRemote !== host.controlRemote || identityKeys.some(key => currentIdentity[key] !== identity[key])) throw new Error('host, control remote or installed release changed after migration review');
      if ((await edges.authenticate(expected, signal)).id !== expected.id) throw new Error('migration approver identity changed after review');
      if ((await ledger.inspectMigration()).commit !== before.commit) throw new Error('control migration source changed after human review; authorization is stale');
      signal.throwIfAborted();
      const record = join(directory, `${decision.id}.json`);
      await atomicJson(record, { schemaVersion: 1, status: 'approved', decision, artifact });
      // Preserve the approved record on any unknown Git outcome. Reinspection
      // is safe and schema-2 migration is idempotent; no mutation is replayed
      // against another source commit under this authorization.
      const migrated = await ledger.migrateQuiescent(before.commit);
      const result = { schemaVersion: migrated.schemaVersion, revision: migrated.revision, historicalRuns: Object.keys(migrated.runs).length, stateHash: digest(JSON.stringify(migrated)) };
      await atomicJson(record, { schemaVersion: 1, status: 'completed', decision, artifact, result });
      return { migrated: true, ...result, reviewedControlCommit: before.commit, decision: record };
    } finally { await release(); }
  };
}

export const migrateControl = migrationCoordinator({
  host: hostConfig, state: stateRoot, identity: releaseIdentity, resolveApprover,
  authenticate: authenticatedApprover, confirm: confirmHumanDecision,
  ledger: (remote, signal) => new GitLedger(remote, (file, args, options) => command(file, args, { ...options, signal })),
});
