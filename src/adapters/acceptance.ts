import { join } from 'node:path';
import { z } from 'zod';
import { capability, evidenceKinds, EvidenceReference, identityKeys, identityShape, observedEvidence, readBoundedEvidenceFile, releaseIdentity, type EvidenceKind } from './acceptance-evidence.js';

export { evidenceKinds, requiredEvidenceChecks, releaseIdentity } from './acceptance-evidence.js';
const Gate = z.object({ schemaVersion: z.literal(3), ...identityShape, host: z.string().uuid(), capability: z.literal(capability), receipts: z.array(EvidenceReference).min(1).max(6) }).strict();
export type AcceptanceGate = z.infer<typeof Gate>;
const prerequisites = ['builder-isolation', 'protected-verifier'] as const;

export async function acceptedPrerequisites(root: string, state: string, host: string): Promise<AcceptanceGate> {
  z.string().uuid().parse(host); const identity = await releaseIdentity(root); const observations = await observedEvidence(state, identity, host, prerequisites);
  const receipts = prerequisites.map(kind => {
    const evidence = observations.get(kind);
    if (!evidence) throw new Error(`missing ${kind} prerequisite evidence for this host`);
    if (evidence.receipt.outcome !== 'pass') throw new Error(`${kind} prerequisite evidence is not passing (${evidence.receipt.outcome})`);
    return evidence.reference;
  });
  return { schemaVersion: 3, ...identity, host, capability, receipts };
}

export async function acceptedRelease(root: string, state: string, input?: unknown, expectedHost?: string): Promise<AcceptanceGate> {
  const gate = Gate.parse(input ?? JSON.parse((await readBoundedEvidenceFile(join(state, 'acceptance.json'), 65_536)).toString('utf8')));
  if (expectedHost && gate.host !== expectedHost) throw new Error('this host has no release acceptance evidence');
  const identity = await releaseIdentity(root);
  if (identityKeys.some(key => gate[key] !== identity[key])) throw new Error('stale release acceptance identity');
  if (new Set(gate.receipts.map(reference => reference.path)).size !== gate.receipts.length) throw new Error('duplicate acceptance evidence');
  const observations = await observedEvidence(state, identity, gate.host); const included = new Set<EvidenceKind>();
  for (const reference of gate.receipts) {
    const current = [...observations.values()].find(item => item.reference.path === reference.path);
    if (!current) throw new Error('stale acceptance evidence; a newer observation or a missing receipt requires review');
    if (reference.hash !== current.reference.hash) throw new Error('acceptance evidence content changed');
    if (included.has(current.receipt.kind)) throw new Error('duplicate acceptance evidence');
    if (current.receipt.outcome !== 'pass') throw new Error(`${current.receipt.kind} acceptance evidence is not passing (${current.receipt.outcome})`);
    included.add(current.receipt.kind);
  }
  for (const kind of [...evidenceKinds, 'real-pilot'] as const) if (!included.has(kind)) throw new Error(`missing ${kind} evidence for this host`);
  return gate;
}
