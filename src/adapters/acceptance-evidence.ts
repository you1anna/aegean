import { ModelPolicySchema } from '../domain/model-policy.js';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { digest } from '../domain/digest.js';
import { POLICY_IDENTITY, policyIdentityFor } from '../domain/workflow-policy.js';
import { treeDigest } from './files.js';
import { fileHash, releaseArtifacts } from './release-artifacts.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const identityShape = { sourceHash: hash, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), buildHash: hash, artifactHash: hash, nodeHash: hash, policyIdentity: hash, image: z.string().regex(/^[\w./:-]+@sha256:[a-f0-9]{64}$/) };
export const identityKeys = ['sourceHash', 'sourceCommit', 'buildHash', 'artifactHash', 'nodeHash', 'policyIdentity', 'image'] as const;
const Identity = z.object(identityShape).strict();
export type ReleaseIdentity = z.infer<typeof Identity>;
export const capability = 'bounded-cli-v1' as const;
export const evidenceKinds = ['builder-isolation', 'protected-verifier', 'live-loop', 'lifecycle', 'recovery'] as const;
const Kind = z.enum([...evidenceKinds, 'real-pilot']);
export type EvidenceKind = z.infer<typeof Kind>;
export const requiredEvidenceChecks: Record<EvidenceKind, readonly string[]> = {
  'builder-isolation': ['workspace-write', 'outside-read-denied', 'symlink-read-denied', 'credentials-denied', 'network-denied', 'detached-writer-contained', 'host-tools-denied', 'oracle-denied', 'container-socket-denied', 'nested-git-denied', 'bounded-resources', 'cancellation-contained'],
  'protected-verifier': ['immutable-suite', 'negative-control', 'repaired-candidate', 'oracle-isolation'],
  'live-loop': ['independent-auditor', 'sandboxed-builder', 'independent-review', 'subscription-only'],
  lifecycle: ['scout', 'exact-spec-approval', 'publication-approval', 'human-merge', 'archive'],
  recovery: ['interruption', 'uncertain-push', 'ownership-race', 'quota', 'cancellation', 'rollback'],
  'real-pilot': ['compatible-project', 'protected-verification', 'human-publication', 'human-merge', 'archive'],
};
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Outcome = z.enum(['pass', 'fail', 'unknown']);
const Observation = z.object({ name: z.string().min(1).max(100), outcome: Outcome, observedAt: timestamp, detail: z.string().max(2048).optional() }).strict();
const Source = z.object({ kind: z.enum(['native-harness', 'coordinator']), name: z.string().min(1).max(100), startedAt: timestamp, finishedAt: timestamp, evidenceHash: hash }).strict();
export type EvidenceObservation = z.infer<typeof Observation>;
export type EvidenceSource = z.infer<typeof Source>;
export const requiredEvidenceSources: Record<EvidenceKind, { kind: EvidenceSource['kind']; name: string }> = {
  'builder-isolation': { kind: 'native-harness', name: 'builder-containment-v1' },
  'protected-verifier': { kind: 'native-harness', name: 'protected-verifier-v1' },
  'live-loop': { kind: 'coordinator', name: 'bounded-cli-coordinator-v1' },
  lifecycle: { kind: 'coordinator', name: 'bounded-cli-coordinator-v1' },
  recovery: { kind: 'coordinator', name: 'bounded-cli-coordinator-v1' },
  'real-pilot': { kind: 'coordinator', name: 'bounded-cli-coordinator-v1' },
};
export const EvidenceReference = z.object({ path: z.string().max(200).regex(/^acceptance-evidence\/[\w.-]+\.json$/), hash }).strict();
export type EvidenceReference = z.infer<typeof EvidenceReference>;
const scope = { schemaVersion: z.literal(2), ...identityShape, host: z.string().uuid(), capability: z.literal(capability), kind: Kind, source: Source, recordedAt: timestamp };
const Report = z.object({ ...scope, observations: z.array(Observation).min(1).max(100), signature: hash }).strict();
const Receipt = z.object({ ...scope, outcome: Outcome, report: EvidenceReference, signature: hash }).strict();
type Report = z.infer<typeof Report>;
type Receipt = z.infer<typeof Receipt>;
export interface ObservedEvidence { reference: EvidenceReference; receipt: Receipt; report: Report }
const limits = { receipt: 65_536, report: 262_144, manifest: 20_000_000, entries: 1000 };

export async function readBoundedEvidenceFile(path: string, maximum = limits.report): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('acceptance evidence must be an exclusive regular file, never a symlink');
  if (before.size > maximum) throw new Error('acceptance evidence exceeds bounded file size');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) throw new Error('acceptance evidence changed during read');
    const bytes = Buffer.alloc(info.size); let offset = 0;
    while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) throw new Error('acceptance evidence changed during read'); offset += result.bytesRead; }
    const after = await handle.stat();
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead || after.size !== info.size || after.nlink !== 1 || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('acceptance evidence changed during read');
    return bytes;
  } finally { await handle.close(); }
}
const jsonFile = async (path: string, maximum: number): Promise<unknown> => JSON.parse((await readBoundedEvidenceFile(path, maximum)).toString('utf8'));

/**
 * Validate shipped files, the external runtime, and frozen executable policy.
 * Source identities originate in the trusted clean-build installer: installed
 * releases contain only shipped artifacts, not enough source to reconstruct Git.
 */
export async function releaseIdentity(root: string): Promise<ReleaseIdentity> {
  const install = z.object({ schemaVersion: z.literal(2), sourceHash: hash, sourceCommit: identityShape.sourceCommit, buildHash: hash, artifactHash: hash, nodeHash: hash }).passthrough().parse(await jsonFile(join(root, 'installation.json'), limits.receipt));
  const pins = z.object({ models: ModelPolicySchema, node: z.string(), policy: z.string(), maxModelCalls: z.number().int(), maxRepairs: z.number().int(), maxRevisions: z.number().int(), maxInfrastructureRetries: z.number().int(), activeTimeoutMs: z.number().int(), verifier: z.object({ image: z.string() }).passthrough() }).passthrough().parse(await jsonFile(join(root, 'toolchain.json'), limits.receipt));
  const policyIdentity = policyIdentityFor(pins);
  if (policyIdentity !== POLICY_IDENTITY) throw new Error('installed policy differs from the frozen coordinator policy');
  if (pins.verifier.image !== toolchain.verifier.image) throw new Error('installed image differs from the pinned runtime image');
  if (pins.node !== toolchain.node || process.versions.node !== toolchain.node) throw new Error('Node runtime differs from the pinned version');
  if (await treeDigest(join(root, 'dist')) !== install.buildHash) throw new Error('installed build differs from accepted build');
  if (digest(JSON.stringify(await releaseArtifacts(root))) !== install.artifactHash || digest(JSON.stringify(await jsonFile(join(root, 'artifact-manifest.json'), limits.manifest))) !== install.artifactHash) throw new Error('installed artifacts differ from accepted release');
  if (await fileHash(process.execPath) !== install.nodeHash) throw new Error('Node executable differs from accepted runtime');
  return Identity.parse({ sourceHash: install.sourceHash, sourceCommit: install.sourceCommit, buildHash: install.buildHash, artifactHash: install.artifactHash, nodeHash: install.nodeHash, policyIdentity, image: pins.verifier.image });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value)!;
}
function signature(value: object, key: Buffer, type: 'report' | 'receipt'): string {
  return createHmac('sha256', key).update(`aegean-acceptance-${type}-v2\n`).update(canonical(value)).digest('hex');
}
function verify(value: Report | Receipt, key: Buffer, type: 'report' | 'receipt'): void {
  const { signature: provided, ...payload } = value;
  if (!timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(signature(payload, key, type), 'hex'))) throw new Error(`acceptance ${type} signature mismatch`);
}
async function realDirectory(path: string, create: boolean): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('acceptance state must be a real coordinator-owned directory without group/world write permission');
}
async function signingKey(state: string, create: boolean): Promise<Buffer> {
  await realDirectory(state, create); const path = join(state, 'acceptance-signing.key');
  if (create) {
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(randomBytes(32)); await handle.sync(); } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 32 || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) throw new Error('acceptance signing key must be a private coordinator-owned regular file with mode 0600');
  return readBoundedEvidenceFile(path, 32);
}
function validateObservations(kind: EvidenceKind, observations: EvidenceObservation[], source: EvidenceSource, recordedAt: number): EvidenceObservation['outcome'] {
  const required = requiredEvidenceChecks[kind]; const names = new Set(observations.map(item => item.name));
  if (names.size !== observations.length || names.size !== required.length || required.some(name => !names.has(name))) throw new Error('acceptance observations must contain exactly the required checks without duplicates or unknown checks');
  const provenance = requiredEvidenceSources[kind];
  if (source.kind !== provenance.kind || source.name !== provenance.name) throw new Error('acceptance evidence source provenance is unsupported for this kind');
  if (source.startedAt > source.finishedAt || source.finishedAt > recordedAt || recordedAt > Date.now() + 5000 || observations.some(item => item.observedAt < source.startedAt || item.observedAt > source.finishedAt)) throw new Error('acceptance observation timestamps are outside their recording window');
  return observations.some(item => item.outcome === 'fail') ? 'fail' : observations.some(item => item.outcome === 'unknown') ? 'unknown' : 'pass';
}
function sameIdentity(left: ReleaseIdentity, right: ReleaseIdentity): boolean { return identityKeys.every(key => left[key] === right[key]); }
async function exclusiveJson(path: string, value: object, maximum: number): Promise<Buffer> {
  const bytes = Buffer.from(canonical(value) + '\n');
  if (bytes.length > maximum) throw new Error('acceptance evidence exceeds bounded file size');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return bytes;
}

/**
 * Internal harness/coordinator API, deliberately not an arbitrary-observation
 * CLI. Only this recorder creates the local signing key. The supervisor must
 * keep this state and its ancestors outside Builder reach. HMAC authenticates
 * trusted coordinator observations, not real-world execution: a malicious
 * operator/root or compromised coordinator remains outside the threat model.
 * Recording failures/unknowns is intentional and never writes acceptance.json.
 */
export async function recordObservedEvidence(root: string, state: string, host: string, kind: EvidenceKind, observations: EvidenceObservation[], source: EvidenceSource): Promise<EvidenceReference> {
  const actualKind = Kind.parse(kind); const actualHost = z.string().uuid().parse(host);
  const actualObservations = z.array(Observation).min(1).max(100).parse(observations); const actualSource = Source.parse(source);
  const identity = await releaseIdentity(root); const recordedAt = Date.now();
  const outcome = validateObservations(actualKind, actualObservations, actualSource, recordedAt);
  const key = await signingKey(state, true); const directory = join(state, 'acceptance-evidence'); await realDirectory(directory, true);
  if ((await readdir(directory)).length > limits.entries - 2) throw new Error('acceptance evidence capacity reached; archive historical evidence deliberately');
  const prefix = `acceptance-evidence/${recordedAt}-${randomUUID()}`;
  const common = { schemaVersion: 2 as const, ...identity, host: actualHost, capability, kind: actualKind, source: actualSource, recordedAt };
  const report = { ...common, observations: actualObservations }; const reportPath = `${prefix}.report.json`;
  const reportBytes = await exclusiveJson(join(state, reportPath), { ...report, signature: signature(report, key, 'report') }, limits.report);
  const receipt = { ...common, outcome, report: { path: reportPath, hash: digest(reportBytes) } }; const receiptPath = `${prefix}.receipt.json`;
  const receiptBytes = await exclusiveJson(join(state, receiptPath), { ...receipt, signature: signature(receipt, key, 'receipt') }, limits.receipt);
  return { path: receiptPath, hash: digest(receiptBytes) };
}

/** Select newest signed observations; a newer failure cannot revive an older pass. */
export async function observedEvidence(state: string, identity: ReleaseIdentity, host: string, kinds: readonly EvidenceKind[] = [...evidenceKinds, 'real-pilot']): Promise<Map<EvidenceKind, ObservedEvidence>> {
  const key = await signingKey(state, false); const directory = join(state, 'acceptance-evidence'); await realDirectory(directory, false);
  const entries = await readdir(directory);
  if (entries.length > limits.entries) throw new Error('acceptance evidence directory exceeds capacity');
  const latest = new Map<EvidenceKind, ObservedEvidence>(); const ambiguous = new Set<EvidenceKind>();
  for (const name of entries.filter(item => item.endsWith('.receipt.json')).sort()) {
    const path = `acceptance-evidence/${name}`; EvidenceReference.shape.path.parse(path);
    const bytes = await readBoundedEvidenceFile(join(state, path), limits.receipt); const receipt = Receipt.parse(JSON.parse(bytes.toString('utf8'))); verify(receipt, key, 'receipt');
    if (receipt.host !== host || !sameIdentity(receipt, identity) || !kinds.includes(receipt.kind)) continue;
    const reportBytes = await readBoundedEvidenceFile(join(state, receipt.report.path), limits.report);
    if (digest(reportBytes) !== receipt.report.hash) throw new Error('acceptance report content changed');
    const report = Report.parse(JSON.parse(reportBytes.toString('utf8'))); verify(report, key, 'report');
    if (!sameIdentity(report, identity) || report.host !== host || report.kind !== receipt.kind || report.recordedAt !== receipt.recordedAt || canonical(report.source) !== canonical(receipt.source)) throw new Error('acceptance report identity or scope differs from receipt');
    if (validateObservations(report.kind, report.observations, report.source, report.recordedAt) !== receipt.outcome) throw new Error('acceptance receipt outcome differs from observations');
    const previous = latest.get(receipt.kind);
    if (previous?.receipt.recordedAt === receipt.recordedAt) ambiguous.add(receipt.kind);
    if (!previous || previous.receipt.recordedAt < receipt.recordedAt) {
      latest.set(receipt.kind, { reference: { path, hash: digest(bytes) }, receipt, report }); ambiguous.delete(receipt.kind);
    }
  }
  if (ambiguous.size) throw new Error('ambiguous concurrent acceptance observations; record a fresh complete observation');
  return latest;
}
