import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readJson, treeDigest, contained } from './files.js';
import { digest } from '../domain/workflow.js';
import { fileHash, releaseArtifacts } from './release-artifacts.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const identity = { sourceHash: hash, sourceCommit: sha, buildHash: hash, artifactHash: hash, nodeHash: hash };
const identityKeys = ['sourceHash', 'sourceCommit', 'buildHash', 'artifactHash', 'nodeHash'] as const;
export const evidenceKinds = ['builder-isolation', 'protected-verifier', 'live-loop', 'lifecycle', 'recovery'] as const;
const kind = z.enum([...evidenceKinds, 'real-pilot']);
export const requiredEvidenceChecks: Record<z.infer<typeof kind>, readonly string[]> = {
  'builder-isolation':['workspace-write','outside-read-denied','symlink-read-denied','credentials-denied','network-denied','detached-writer-contained'],
  'protected-verifier':['immutable-suite','negative-control','repaired-candidate','oracle-isolation'],
  'live-loop':['independent-auditor','sandboxed-builder','independent-review','subscription-only'],
  'lifecycle':['scout','exact-spec-approval','publication-approval','human-merge','archive'],
  'recovery':['interruption','uncertain-push','ownership-race','quota','cancellation','rollback'],
  'real-pilot':['compatible-project','protected-verification','human-publication','human-merge','archive'],
};
const Gate = z.object({ schemaVersion:z.literal(2), ...identity, hosts:z.object({air:z.string().uuid(),mini:z.string().uuid()}).strict(), receipts:z.array(z.object({path:z.string().regex(/^acceptance-evidence\/[\w.-]+\.json$/),hash}).strict()).min(11).max(30) }).strict();
const Receipt = z.object({schemaVersion:z.literal(1),...identity,kind,host:z.string().uuid(),passed:z.literal(true),report:z.object({path:z.string().regex(/^acceptance-evidence\/[\w.-]+\.json$/),hash}).strict()}).strict();
const Report = z.object({schemaVersion:z.literal(1),...identity,kind,host:z.string().uuid(),checks:z.array(z.object({name:z.string().min(1).max(100),passed:z.literal(true)}).strict()).min(1).max(100)}).strict();
export async function acceptedRelease(root: string, state: string, input?: unknown, expectedHost?: string): Promise<z.infer<typeof Gate>> {
  const install = z.object({schemaVersion:z.literal(2),...identity}).passthrough().parse(await readJson(join(root,'installation.json')));
  const gate = Gate.parse(input ?? await readJson(join(state,'acceptance.json')));
  if (gate.hosts.air === gate.hosts.mini) throw new Error('acceptance requires distinct Air and mini host identities');
  if (expectedHost && !Object.values(gate.hosts).includes(expectedHost)) throw new Error('this host has no release acceptance evidence');
  for (const key of identityKeys) if (gate[key] !== install[key]) throw new Error('stale release acceptance identity');
  if (await treeDigest(join(root,'dist')) !== install.buildHash) throw new Error('installed build differs from accepted build');
  if (digest(JSON.stringify(await releaseArtifacts(root))) !== install.artifactHash || digest(JSON.stringify(await readJson(join(root,'artifact-manifest.json')))) !== install.artifactHash) throw new Error('installed artifacts differ from accepted release');
  if (await fileHash(process.execPath) !== install.nodeHash) throw new Error('Node executable differs from accepted runtime');
  const observed = new Set<string>();
  for (const reference of gate.receipts) {
    const bytes = await readFile(await contained(state, reference.path));
    if (digest(bytes) !== reference.hash) throw new Error('acceptance evidence content changed');
    const receipt = Receipt.parse(JSON.parse(bytes.toString()));
    const report = await readFile(await contained(state, receipt.report.path));
    if (digest(report) !== receipt.report.hash) throw new Error('acceptance report content changed');
    const checks = Report.parse(JSON.parse(report.toString()));
    if (checks.host !== receipt.host || checks.kind !== receipt.kind) throw new Error('acceptance report scope differs from receipt');
    const names = new Set(checks.checks.map(check => check.name));
    if (names.size !== checks.checks.length || requiredEvidenceChecks[checks.kind].some(name => !names.has(name))) throw new Error('acceptance report omits required passing checks');
    for (const key of identityKeys) if (receipt[key] !== install[key] || checks[key] !== install[key]) throw new Error('evidence belongs to another release');
    if (![gate.hosts.air,gate.hosts.mini].includes(receipt.host)) throw new Error('evidence belongs to an unknown host');
    const key = `${receipt.host}:${receipt.kind}`;
    if (observed.has(key)) throw new Error('duplicate acceptance evidence');
    observed.add(key);
  }
  for (const host of Object.values(gate.hosts)) for (const required of evidenceKinds) if (!observed.has(`${host}:${required}`)) throw new Error(`missing ${required} evidence for a required host`);
  if (![...observed].some(value=>value.endsWith(':real-pilot'))) throw new Error('real-pilot evidence missing');
  return gate;
}
