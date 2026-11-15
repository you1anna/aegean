import { PilotRecord } from './pilot.js';
import { assertDecision } from '../adapters/human-decision.js';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicJson } from '../adapters/files.js';
import { identityShape, releaseIdentity, readBoundedEvidenceFile, recordObservedEvidence, requiredEvidenceChecks, type EvidenceKind, type EvidenceObservation } from '../adapters/acceptance-evidence.js';
import { digest, type Run } from '../domain/workflow.js';
import { stateRoot } from './runtime.js';
const kinds = ['live-loop', 'lifecycle', 'recovery', 'real-pilot'] as const;
type Kind = typeof kinds[number];
const Observation = z.object({ name: z.string(), outcome: z.enum(['pass', 'fail', 'unknown']), observedAt: z.number().int().positive(), detail: z.string().max(2048) }).strict();
const Journal = z.object({ schemaVersion: z.literal(1), run: z.string(), host: z.string(), release: z.object(identityShape).strict(), startedAt: z.number().int().positive(), observations: z.record(z.string(), Observation) }).strict();
async function journal(root: string, dir: string, run: Run) {
  const release = await releaseIdentity(root);
  try {
    const saved = Journal.parse(JSON.parse((await readBoundedEvidenceFile(join(dir, 'observations.json'), 65_536)).toString('utf8')));
    if (saved.run !== run.id || saved.host !== run.host || digest(JSON.stringify(saved.release)) !== digest(JSON.stringify(release))) throw new Error('observation scope changed');
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return Journal.parse({ schemaVersion: 1, run: run.id, host: run.host, release, startedAt: Date.now(), observations: {} });
  }
}
/** Internal coordinator observations only; no user-supplied booleans or CLI input. */
export async function observeRun(root: string, dir: string, run: Run, kind: Kind, name: string, outcome: EvidenceObservation['outcome'], evidence: unknown): Promise<void> {
  if (!requiredEvidenceChecks[kind].includes(name)) throw new Error('unsupported coordinator observation');
  const saved = await journal(root, dir, run);
  saved.observations[`${kind}:${name}`] = { name, outcome, observedAt: Date.now(), detail: `Run ${run.id}; observed artifact SHA-256 ${digest(JSON.stringify(evidence))}` };
  await atomicJson(join(dir, 'observations.json'), Journal.parse(saved));
}
/** Missing exercises remain unknown. This writes evidence, never acceptance.json. */
export async function finalizeRunEvidence(root: string, dir: string, run: Run, selected?: readonly Kind[]) {
  const saved = await journal(root, dir, run); const finishedAt = Date.now();
  const references = [];
  const finalize = selected ?? ['live-loop', 'lifecycle', ...(saved.observations['real-pilot:compatible-project'] ? ['real-pilot' as const] : [])] as readonly Kind[];
  for (const kind of finalize) {
    // Ordinary runs retain journals without replacing release-qualification
    // receipts. New receipts would invalidate an existing acceptance manifest.
    if (!saved.observations['real-pilot:compatible-project']) continue;
    const pilot = PilotRecord.parse(JSON.parse((await readBoundedEvidenceFile(join(dir, 'pilot.json'), 65_536)).toString('utf8')));
    assertDecision(pilot.decision, 'pilot', run.id, pilot.artifact, run.approver);
    const validWindow = pilot.decision.decidedAt < pilot.artifact.expiresAt && finishedAt < pilot.artifact.expiresAt;
    const observations = requiredEvidenceChecks[kind as EvidenceKind].map(name => saved.observations[`${kind}:${name}`] ?? { name, outcome: 'unknown' as const, observedAt: finishedAt, detail: `Run ${run.id}: no observation; acceptance remains incomplete` });
    if (!validWindow) for (const observation of observations) { observation.outcome = 'unknown'; observation.detail = 'Pilot authorization expired; acceptance remains incomplete'; }
    references.push(await recordObservedEvidence(root, stateRoot(), run.host, kind, observations, { kind: 'coordinator', name: 'bounded-cli-coordinator-v1', startedAt: saved.startedAt, finishedAt, evidenceHash: digest(JSON.stringify(saved)) }));
  }
  await atomicJson(join(dir, 'evidence-receipts.json'), { run: run.id, references });
  return references;
}
