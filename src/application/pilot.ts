import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { identityShape, releaseIdentity, readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { assertDecision, type HumanDecision } from '../adapters/human-decision.js';
import { digest, type Run } from '../domain/workflow.js';
import { ExecutionBudget, defaultBudget, remainingExecution } from '../domain/budgets.js';
import { privateRunDirectory, type LocalRun } from './run-record.js';
import { DecisionSchema, frozenProject } from './decisions.js';
import { budgetStatus } from './usage-budget.js';
const Artifact = z.object({ schemaVersion: z.literal(1), kind: z.literal('pilot'), host: z.string().uuid(), run: z.string(), repository: z.string(), request: z.string().regex(/^[a-f0-9]{64}$/), projectPolicy: z.string().regex(/^[a-f0-9]{64}$/), release: z.object(identityShape).strict(), expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), budget: ExecutionBudget, limitsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type PilotArtifact = z.infer<typeof Artifact>;
export const PilotRecord = z.object({ artifact: Artifact, decision: DecisionSchema }).strict();
export async function pilotArtifact(root: string, dir: string, local: LocalRun, run: Run, expiresAt: number, budget: ExecutionBudget, limitsDigest?: string): Promise<PilotArtifact> {
  await privateRunDirectory(dir); await frozenProject(local, run, { allowMissingWorktree: true });
  return Artifact.parse({ schemaVersion: 1, kind: 'pilot', host: run.host, run: run.id, repository: run.repository, request: digest(await readBoundedEvidenceFile(local.sourceRequest, 60_000)), projectPolicy: run.projectPolicy, release: await releaseIdentity(root), expiresAt, budget, ...(limitsDigest ? {limitsDigest} : {}) });
}
export async function persistPilot(dir: string, run: Run, artifact: PilotArtifact, decision: HumanDecision): Promise<void> {
  await privateRunDirectory(dir); PilotRecord.parse({ artifact, decision });
  assertDecision(decision, 'pilot', run.id, artifact, run.approver);
  if (decision.decidedAt >= artifact.expiresAt || artifact.expiresAt <= Date.now()) throw new Error('pilot authorization expired');
  const file = await open(join(dir, 'pilot.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify({ artifact, decision })); await file.sync(); } finally { await file.close(); }
  const folder = await open(dir, 'r'); try { await folder.sync(); } finally { await folder.close(); }
}
export async function savedPilot(dir: string): Promise<z.infer<typeof PilotRecord> | undefined> {
  try { return PilotRecord.parse(JSON.parse((await readBoundedEvidenceFile(join(dir, 'pilot.json'), 65_536)).toString('utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined; }
}
/** An authorisation is written once. A repeated request with the same limits reports it; no other request can replace it. */
export function repeatedPilot(saved: PilotArtifact, run: string, requested: { expiresAt?: number; budget?: ExecutionBudget; limitsDigest?: string }, now = Date.now()) {
  if (saved.run !== run) throw new Error('pilot authorization belongs to another run');
  const budget = ExecutionBudget.safeParse(requested.budget);
  const sameLimits = budget.success && digest(JSON.stringify(saved.budget)) === digest(JSON.stringify(budget.data))
    && (saved.limitsDigest || requested.limitsDigest ? saved.limitsDigest === requested.limitsDigest : saved.expiresAt === requested.expiresAt);
  if (!sameLimits) throw new Error(`run already has a pilot authorization with different limits; it cannot be replaced. Inspect it with aegean status --run ${run}`);
  if (saved.expiresAt <= now) throw new Error(`pilot authorization expired at ${new Date(saved.expiresAt).toISOString()}; it cannot be replaced. Cancel this run and prepare a new run`);
  return { alreadyAuthorized: true as const, expiresAt: new Date(saved.expiresAt).toISOString(), budget: saved.budget };
}
export async function executionAuthorization(root: string, dir: string, local: LocalRun, run: Run, ordinaryReady: boolean) {
  const saved = await savedPilot(dir);
  // A pilot's limits continue to apply even if ordinary acceptance arrives later.
  if (saved) {
    const actual = await pilotArtifact(root, dir, local, run, saved.artifact.expiresAt, saved.artifact.budget, saved.artifact.limitsDigest);
    assertDecision(saved.decision, 'pilot', run.id, actual, run.approver);
    if (digest(JSON.stringify(actual)) !== digest(JSON.stringify(saved.artifact)) || saved.decision.decidedAt >= actual.expiresAt) throw new Error('pilot authorization scope changed');
  } else if (!ordinaryReady) throw new Error(`Pilot authorization required: aegean authorize-pilot --run ${run.id}; ordinary acceptance is pending`);
  const budget = saved?.artifact.budget ?? defaultBudget;
  const usage = await budgetStatus(dir);
  const remainingMs = remainingExecution(run, budget, usage.activeMs, Date.now(), saved?.artifact.expiresAt);
  return { budget, usage, remainingMs, pilot: saved?.artifact };
}
