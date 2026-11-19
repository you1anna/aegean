import { STOP_REASONS, type Run } from './run.js';
import { REVIEW_NOTES } from './scout.js';

export interface StepFacts { pilotExpiresAt?: number; specification?: string; runFolder?: string }
type Guided = Pick<Run, 'id' | 'state'> & Partial<Pick<Run, 'reason' | 'publicationRef' | 'repairs'>>;

/** The private file that holds the evidence for a stop by a check or a finding owner. */
function stopEvidence(run: Guided, folder: string | undefined): string[] {
  if (!folder) return [];
  if (run.reason === STOP_REASONS.baseline) return [`Read the base commit results in ${folder}/baseline.json`];
  if (run.reason === STOP_REASONS.spec || run.reason === STOP_REASONS.factory) return [`Read the review findings in ${folder}/review-${run.repairs ?? 0}.json`];
  return [];
}

/** Operator guidance only. It grants no permission and replaces no gate. */
export function nextSteps(run: Guided, facts: StepFacts = {}, now = Date.now()): string[] {
  const id = run.id, resume = `aegean resume --run ${id}`;
  if (facts.pilotExpiresAt !== undefined && facts.pilotExpiresAt <= now && !['cancelled', 'archived', 'escalated'].includes(run.state))
    return [`The pilot authorisation expired at ${new Date(facts.pilotExpiresAt).toISOString()}. It cannot be replaced.`, `Stop this run: aegean cancel --run ${id}`, 'Then, for new work, run in the project repository: aegean prepare --request FILE'];
  const folder = facts.specification ?? `openspec/changes/${id}/ in the run worktree`;
  switch (run.state) {
    case 'requested': return [
      ...(facts.pilotExpiresAt !== undefined ? [] : [`If aegean doctor reports that the full workflow is not ready, authorise a pilot first: aegean authorize-pilot --run ${id} --limits FILE`]),
      `Draft the specification (one model call): ${resume}`,
    ];
    case 'spec-drafted': return [
      `Read ${REVIEW_NOTES}, then the specification, in ${folder}`,
      `To change the specification, edit the files in that folder, then record the edit: ${resume}`,
      `To approve in local approval mode: aegean approve --run ${id}, then ${resume}`,
      `If the request or the project guidance is wrong, stop this run: aegean cancel --run ${id}`,
    ];
    case 'spec-approved': case 'tests-staged': case 'building': case 'verifying': case 'reviewing': case 'repair':
      return [`Continue the run: ${resume}`];
    case 'human-merge-review': return run.publicationRef
      ? ['Review and merge the pull request yourself. Aegean does not merge.', `After the merge, archive the specification: ${resume}`]
      : [`Review the candidate, then publish it: aegean publish --run ${id}`, `To change the candidate, edit it, then run: aegean revise --run ${id} --scope implementation|contract`];
    case 'merged': return [`Archive the specification: ${resume}`];
    case 'paused': return [`Correct the cause of the pause: ${run.reason ?? 'unknown; inspect the private diagnostic log'}`, `Then continue: ${resume}`, `Or stop the run: aegean cancel --run ${id}`];
    case 'escalated': return [`The run stopped and cannot continue: ${run.reason ?? 'no reason recorded'}`, ...stopEvidence(run, facts.runFolder), 'Read "Recovery" in the operations guide before new work.'];
    case 'cancelled': case 'archived': return ['This run is complete. For new work, run in the project repository: aegean prepare --request FILE'];
  }
}

export interface QualificationFacts {
  prerequisitesPassed: boolean; cleanupConfirmed: boolean; retainedResources: string[]; workDirectory: string;
  reports: { kind: string; observations: { name: string; outcome: string }[] }[];
}

/** Operator guidance after aegean qualify. It explains a failed or unknown control and names the next command. */
export function qualificationSteps(facts: QualificationFacts): string[] {
  const named = (outcome: string) => facts.reports.flatMap(report => report.observations.filter(item => item.outcome === outcome).map(item => `${report.kind}/${item.name}`));
  const failed = named('fail'), unknown = named('unknown');
  if (facts.prerequisitesPassed) return [
    'This host and release are qualified. Confirm the check: aegean doctor --require prerequisites',
    'Start or continue a run in the project repository: aegean guide',
    'Qualification applies to one installed release. After each install or upgrade, run: aegean qualify',
  ];
  const steps: string[] = [];
  if (!facts.cleanupConfirmed) steps.push(
    `The probes did not confirm cleanup. These resources can remain: ${facts.retainedResources.join(', ') || 'not identified'}`,
    'Make sure that no Aegean process runs, then inspect the verifier: aegean verifier status',
    'If the verifier reports retained or uncertain resources, recover it: aegean verifier recover --confirm-stopped',
  );
  if (failed.length) steps.push(
    `A containment control failed: ${failed.join(', ')}. Pilot runs stay blocked. Do not bypass this check.`,
    `Read the detail of each failed observation above, and the probe records in ${facts.workDirectory}`,
    'Read "Check the installation" in the operations guide. Correct the cause before you qualify again.',
  );
  if (unknown.length) steps.push(
    `These controls gave no result: ${unknown.join(', ')}. Usually the verifier VM was unavailable or the probes were interrupted.`,
    'Make sure that the verifier runs: aegean verifier status',
  );
  steps.push('Then qualify again: aegean qualify');
  return steps;
}

export function listSteps(states: string[]): string[] {
  const active = states.some(state => !['cancelled', 'archived', 'escalated'].includes(state));
  return active ? ['Inspect a run and its next step: aegean status --run ID'] : ['No run is active. A run exists only after you run this in the project repository: aegean prepare --request FILE'];
}
