import { capability, identityKeys, recordObservedEvidence, releaseIdentity, type EvidenceKind } from '../adapters/acceptance-evidence.js';
import { runQualificationProbes } from '../adapters/qualification-probes.js';
import { qualificationSteps } from '../domain/next-steps.js';

interface QualificationEdges {
  identity: typeof releaseIdentity;
  probes: (root: string, signal: AbortSignal) => ReturnType<typeof runQualificationProbes>;
  record: typeof recordObservedEvidence;
}

// Internal application dependency injection permits deterministic orchestration
// tests. The public CLI uses qualifyHost, whose trusted edges are fixed below.
export function qualificationCoordinator(edges: QualificationEdges) {
  return async (root: string, state: string, host: string, signal: AbortSignal) => {
    signal.throwIfAborted(); const before = await edges.identity(root);
    const observed = await edges.probes(root, signal); const after = await edges.identity(root);
    if (identityKeys.some(key => before[key] !== after[key])) throw new Error('installed qualification artifacts changed during the native probes; no evidence recorded');
    const reports = [];
    for (const [kind, evidence] of [['builder-isolation', observed.builder], ['protected-verifier', observed.verifier]] as const) {
      const reference = await edges.record(root, state, host, kind, evidence.observations, evidence.source);
      const outcome = evidence.observations.some(item => item.outcome === 'fail') ? 'fail' : evidence.observations.every(item => item.outcome === 'pass') ? 'pass' : 'unknown';
      reports.push({ kind: kind as EvidenceKind, reference, outcome, observations: evidence.observations });
    }
    const result = { host, capability, identity: after, prerequisitesPassed: observed.cleanupConfirmed && reports.every(report => report.outcome === 'pass'), acceptanceWritten: false as const, reports, workDirectory: observed.workDirectory, cleanupConfirmed: observed.cleanupConfirmed, retainedResources: observed.retainedResources, limitations: observed.limitations };
    return { ...result, next: qualificationSteps(result) };
  };
}

export const qualifyHost = qualificationCoordinator({ identity: releaseIdentity, probes: runQualificationProbes, record: recordObservedEvidence });
