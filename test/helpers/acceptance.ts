import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { treeDigest, atomicJson } from '../../src/adapters/files.js';
import { evidenceKinds, requiredEvidenceChecks, releaseIdentity } from '../../src/adapters/acceptance.js';
import { recordObservedEvidence, type EvidenceKind, type EvidenceObservation, type EvidenceSource } from '../../src/adapters/acceptance-evidence.js';
import { digest } from '../../src/domain/workflow.js';
import { fileHash, releaseArtifacts } from '../../src/adapters/release-artifacts.js';
import toolchain from '../../toolchain.json' with { type: 'json' };

export function fixtureObservations(kind: EvidenceKind): EvidenceObservation[] {
  return requiredEvidenceChecks[kind].map(name => ({ name, outcome: 'pass', observedAt: Date.now(), detail: 'Synthetic test fixture models a trusted observation; never native acceptance evidence.' }));
}
export function fixtureSource(kind: EvidenceKind, observations = fixtureObservations(kind)): EvidenceSource {
  const native = kind === 'builder-isolation' || kind === 'protected-verifier';
  return { kind: native ? 'native-harness' : 'coordinator', name: native ? kind === 'builder-isolation' ? 'builder-containment-v1' : 'protected-verifier-v1' : 'bounded-cli-coordinator-v1', startedAt: Math.min(...observations.map(item => item.observedAt)), finishedAt: Math.max(...observations.map(item => item.observedAt)), evidenceHash: digest('Synthetic fixture: modeled trusted observations, not live evidence') };
}

// Test-only simulation of trusted recorder inputs. Production always rejects
// synthetic provenance; this helper must never write operator state or be used
// by an acceptance harness. The fixture metadata remains part of its identity.
export async function syntheticAcceptance(root: string, state: string, host = randomUUID(), kinds: readonly EvidenceKind[] = [...evidenceKinds, 'real-pilot'], adapters = { recordObservedEvidence, releaseIdentity }) {
  const temporary = await realpath(tmpdir()); const release = await realpath(root); const rel = relative(temporary, release); const fixtureName = rel.split(sep)[0]!;
  if (rel.startsWith('..') || !/^aegean-[\w-]+-test-/.test(fixtureName)) throw new Error('synthetic acceptance requires a named temporary test fixture');
  const fixtureRoot = join(temporary, fixtureName); let existing = resolve(state); const missing: string[] = [];
  for (;;) { try { existing = await realpath(existing); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; missing.unshift(basename(existing)); existing = dirname(existing); } }
  const statePath = join(existing, ...missing); const stateRelative = relative(fixtureRoot, statePath);
  if (!stateRelative || stateRelative.startsWith('..') || stateRelative.startsWith(sep)) throw new Error('synthetic acceptance state is outside its test fixture');
  const existingRelative = relative(fixtureRoot, existing);
  if (existingRelative.startsWith('..') || existingRelative.startsWith(sep)) throw new Error('synthetic acceptance state escapes its test fixture');
  await mkdir(statePath, { recursive: true, mode: 0o700 });
  try { await readFile(join(root, 'toolchain.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeFile(join(root, 'toolchain.json'), JSON.stringify(toolchain)); }
  await writeFile(join(root, 'fixture-evidence.json'), JSON.stringify({ synthetic: true, purpose: 'Test-only modeled acceptance; never live evidence' }));
  const artifacts = await releaseArtifacts(root); await atomicJson(join(root, 'artifact-manifest.json'), artifacts);
  const identity = { sourceHash: 'f'.repeat(64), sourceCommit: 'a'.repeat(40), buildHash: await treeDigest(join(root, 'dist')), artifactHash: digest(JSON.stringify(artifacts)), nodeHash: await fileHash(process.execPath) };
  await atomicJson(join(root, 'installation.json'), { schemaVersion: 2, ...identity });
  const receipts: { path: string; hash: string }[] = [];
  for (const kind of kinds) {
    const observations = fixtureObservations(kind);
    receipts.push(await adapters.recordObservedEvidence(root, state, host, kind, observations, fixtureSource(kind, observations)));
  }
  const gate = { schemaVersion: 3 as const, ...await adapters.releaseIdentity(root), host, capability: 'bounded-cli-v1' as const, receipts };
  await atomicJson(join(state, 'acceptance.json'), gate); return gate;
}
