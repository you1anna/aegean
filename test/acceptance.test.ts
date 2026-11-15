import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac, randomUUID } from 'node:crypto';
import { acceptedPrerequisites, acceptedRelease, releaseIdentity } from '../src/adapters/acceptance.js';
import { recordObservedEvidence } from '../src/adapters/acceptance-evidence.js';
import { syntheticAcceptance, fixtureObservations, fixtureSource } from './helpers/acceptance.js';
import { digest } from '../src/domain/workflow.js';

async function fixture(body: (root: string, state: string) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), 'aegean-acceptance-test-')); const root = join(parent, 'release'); const state = join(parent, 'state');
  try { await mkdir(join(root, 'dist'), { recursive: true }); await writeFile(join(root, 'dist/app.js'), 'synthetic build'); await body(root, state); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

test('one accepted host qualifies independently; another host, old flags and unsupported capabilities fail', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state); const accepted = await acceptedRelease(root, state, undefined, gate.host);
  assert.equal(accepted.host, gate.host); assert.equal(accepted.capability, 'bounded-cli-v1'); assert.equal(accepted.schemaVersion, 3);
  assert.equal(gate.receipts.length, 6); assert.equal('hosts' in gate, false);
  await assert.rejects(acceptedRelease(root, state, gate, randomUUID()), /this host/);
  await assert.rejects(acceptedRelease(root, state, { ...gate, schemaVersion: 2 }));
  await assert.rejects(acceptedRelease(root, state, { builderIsolation: true, protectedVerifier: true }));
  await assert.rejects(acceptedRelease(root, state, { ...gate, capability: 'cross-host-handoff' }));
  await assert.rejects(acceptedRelease(root, state, { ...gate, sourceCommit: 'b'.repeat(40) }), /stale|identity/);
}));

test('hosts bind distinct installed artifacts while retaining the common source identity', async () => fixture(async (root, state) => {
  const first = await syntheticAcceptance(root, state); const secondRoot = join(dirname(root), 'second-release'); const secondState = join(dirname(root), 'second-state');
  await mkdir(join(secondRoot, 'dist'), { recursive: true }); await writeFile(join(secondRoot, 'dist/app.js'), 'different platform artifact');
  const second = await syntheticAcceptance(secondRoot, secondState);
  assert.equal(first.sourceCommit, second.sourceCommit); assert.equal(first.sourceHash, second.sourceHash); assert.notEqual(first.artifactHash, second.artifactHash); assert.notEqual(first.buildHash, second.buildHash);
  await acceptedRelease(root, state, first, first.host); await acceptedRelease(secondRoot, secondState, second, second.host);
  await assert.rejects(acceptedRelease(root, state, second, second.host), /stale|identity/);
}));

test('native prerequisites do not require ordinary acceptance, lifecycle or real-pilot evidence', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state, randomUUID(), ['builder-isolation', 'protected-verifier']);
  await assert.rejects(acceptedRelease(root, state), /missing.*live-loop/);
  await rm(join(state, 'acceptance.json'));
  const prerequisites = await acceptedPrerequisites(root, state, gate.host); assert.equal(prerequisites.receipts.length, 2);
  await assert.rejects(acceptedPrerequisites(root, state, randomUUID()), /missing|host/);
  await assert.rejects(access(join(state, 'acceptance.json')));
}));

test('unrelated lifecycle reports do not participate in native prerequisite validation', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state);
  for (const reference of gate.receipts) {
    const receipt = JSON.parse(await readFile(join(state, reference.path), 'utf8'));
    if (receipt.kind === 'lifecycle') await writeFile(join(state, receipt.report.path), 'unusable lifecycle report');
  }
  assert.equal((await acceptedPrerequisites(root, state, gate.host)).receipts.length, 2);
  await assert.rejects(acceptedRelease(root, state), /report content changed/);
}));

test('failed and unknown observations are recorded, invalidate older passing evidence, and never qualify', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state);
  for (const outcome of ['fail', 'unknown'] as const) {
    const observations = fixtureObservations('builder-isolation'); observations[0]!.outcome = outcome;
    const reference = await recordObservedEvidence(root, state, gate.host, 'builder-isolation', observations, fixtureSource('builder-isolation', observations));
    const receipt = JSON.parse(await readFile(join(state, reference.path), 'utf8')); assert.equal(receipt.outcome, outcome);
    await assert.rejects(acceptedPrerequisites(root, state, gate.host), /passing|failed|unknown/);
    await assert.rejects(acceptedRelease(root, state), /passing|failed|unknown|newer|stale/);
  }
}));

test('edited reports and receipts cannot be authorized by recomputing their public hashes', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state); const first = gate.receipts[0]!;
  const receiptPath = join(state, first.path); const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const reportPath = join(state, receipt.report.path); const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.observations[0].detail = 'fabricated after recording';
  const reportText = JSON.stringify(report); await writeFile(reportPath, reportText); receipt.report.hash = digest(reportText);
  const receiptText = JSON.stringify(receipt); await writeFile(receiptPath, receiptText);
  const forged = { ...gate, receipts: gate.receipts.map((item, i) => i === 0 ? { ...item, hash: digest(receiptText) } : item) };
  await assert.rejects(acceptedRelease(root, state, forged), /signature/);
  // Give the forged receipt a valid fixture signature to verify that the report
  // has its own independent signature, rather than relying only on its hash.
  delete receipt.signature;
  const names = new Set<string>();
  function collect(value: unknown): void { if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) { names.add(name); collect(item); } }
  collect(receipt);
  receipt.signature = createHmac('sha256', await readFile(join(state, 'acceptance-signing.key'))).update('aegean-acceptance-receipt-v2\n').update(JSON.stringify(receipt, [...names].sort())).digest('hex');
  const resigned = JSON.stringify(receipt); await writeFile(receiptPath, resigned);
  await assert.rejects(acceptedRelease(root, state, { ...forged, receipts: forged.receipts.map((item, i) => i === 0 ? { ...item, hash: digest(resigned) } : item) }), /report signature mismatch/);
}));

test('validation never creates a missing signing key and refuses exposed or substituted keys', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state); const path = join(state, 'acceptance-signing.key'); const saved = join(state, 'saved-key');
  await rename(path, saved); await assert.rejects(acceptedRelease(root, state), /key|ENOENT/); await assert.rejects(access(path));
  await rename(saved, path); await chmod(path, 0o644); await assert.rejects(acceptedRelease(root, state), /private|permission/); await chmod(path, 0o600);
  await chmod(state, 0o777); await assert.rejects(acceptedRelease(root, state), /coordinator-owned/); await chmod(state, 0o700);
  await writeFile(path, Buffer.alloc(32)); await assert.rejects(acceptedRelease(root, state, gate), /signature/);
}));

test('artifact, policy, pinned image and actual runtime drift invalidate evidence', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state);
  await assert.rejects(acceptedRelease(root, state, { ...gate, policyIdentity: '0'.repeat(64) }), /identity|stale/);
  await assert.rejects(acceptedRelease(root, state, { ...gate, image: `node@sha256:${'0'.repeat(64)}` }), /identity|stale/);
  await writeFile(join(root, 'extra'), 'unaccepted artifact'); await assert.rejects(acceptedRelease(root, state), /artifacts differ/); await rm(join(root, 'extra'));
  const pinsPath = join(root, 'toolchain.json'); const original = await readFile(pinsPath, 'utf8'); const pins = JSON.parse(original);
  await writeFile(pinsPath, JSON.stringify({ ...pins, maxRepairs: pins.maxRepairs + 1 })); await assert.rejects(releaseIdentity(root), /policy/);
  await writeFile(pinsPath, JSON.stringify({ ...pins, verifier: { ...pins.verifier, image: `node@sha256:${'0'.repeat(64)}` } })); await assert.rejects(releaseIdentity(root), /image/); await writeFile(pinsPath, original);
  const manifest = JSON.parse(await readFile(join(root, 'installation.json'), 'utf8')); await writeFile(join(root, 'installation.json'), JSON.stringify({ ...manifest, nodeHash: '0'.repeat(64) }));
  await assert.rejects(releaseIdentity(root), /Node/); await writeFile(join(root, 'installation.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'dist/app.js'), 'unaccepted build'); await assert.rejects(acceptedRelease(root, state), /build differs/);
}));

test('recorder rejects duplicate, missing and unknown checks, incoherent times and synthetic provenance', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state); const checks = fixtureObservations('builder-isolation'); const source = fixtureSource('builder-isolation', checks);
  for (const observations of [[...checks, checks[0]!], checks.slice(1), [...checks.slice(1), { ...checks[0]!, name: 'easier-invented-check' }]]) {
    await assert.rejects(recordObservedEvidence(root, state, gate.host, 'builder-isolation', observations, source), /checks/);
  }
  await assert.rejects(recordObservedEvidence(root, state, gate.host, 'builder-isolation', checks, { ...source, kind: 'synthetic-fixture' } as never));
  await assert.rejects(recordObservedEvidence(root, state, gate.host, 'builder-isolation', checks, { ...source, kind: 'coordinator' }), /source|provenance/);
  await assert.rejects(recordObservedEvidence(root, state, gate.host, 'builder-isolation', checks, { ...source, finishedAt: source.startedAt - 1 }), /time|window/);
  await assert.rejects(acceptedRelease(root, state, { ...gate, receipts: [...gate.receipts.slice(0, 5), gate.receipts[0]!] }), /duplicate/);
}));

test('evidence reads reject oversized files and symlinks', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state); const reference = gate.receipts[0]!; const path = join(state, reference.path);
  await writeFile(path, 'x'.repeat(300_000)); await assert.rejects(acceptedRelease(root, state), /size|bound|capacity/);
  await rm(path); const outside = join(state, 'outside'); await writeFile(outside, '{}'); await symlink(outside, path);
  await assert.rejects(acceptedRelease(root, state), /regular|symlink/);
}));

test('concurrent observations use unique files and a later complete observation recovers ambiguity', async () => fixture(async (root, state) => {
  const gate = await syntheticAcceptance(root, state); const observations = fixtureObservations('builder-isolation'); const source = fixtureSource('builder-isolation', observations);
  const references = await Promise.all([recordObservedEvidence(root, state, gate.host, 'builder-isolation', observations, source), recordObservedEvidence(root, state, gate.host, 'builder-isolation', observations, source)]);
  assert.notEqual(references[0]!.path, references[1]!.path);
  for (const reference of references) await access(join(state, reference.path));
  const latestObservations = fixtureObservations('builder-isolation');
  const latest = await recordObservedEvidence(root, state, gate.host, 'builder-isolation', latestObservations, fixtureSource('builder-isolation', latestObservations));
  assert.ok((await acceptedPrerequisites(root, state, gate.host)).receipts.some(reference => reference.path === latest.path));
}));

test('synthetic helper refuses nonfixture roots and state outside its temporary fixture', async () => fixture(async (root, state) => {
  await assert.rejects(syntheticAcceptance(tmpdir(), state), /named temporary test fixture/);
  const outside = `${dirname(root)}-outside`;
  await assert.rejects(syntheticAcceptance(root, outside), /outside its test fixture/);
  await assert.rejects(access(outside));
}));
