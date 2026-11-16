import type { Run } from './workflow.js';
import { REVIEW_NOTES } from './scout.js';

export interface StepFacts { pilot?: boolean; specification?: string }
type Guided = Pick<Run, 'id' | 'state'> & Partial<Pick<Run, 'reason' | 'publicationRef'>>;

/** Operator guidance only. It grants no permission and replaces no gate. */
export function nextSteps(run: Guided, facts: StepFacts = {}): string[] {
  const id = run.id, resume = `aegean resume --run ${id}`;
  const folder = facts.specification ?? `openspec/changes/${id}/ in the run worktree`;
  switch (run.state) {
    case 'requested': return [
      ...(facts.pilot ? [] : [`If aegean doctor shows fullWorkflowReady false, authorise a pilot first: aegean authorize-pilot --run ${id} --limits FILE`]),
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
    case 'escalated': return [`The run stopped and cannot continue: ${run.reason ?? 'no reason recorded'}`, 'Read "Recovery" in the operations guide before new work.'];
    case 'cancelled': case 'archived': return ['This run is complete. For new work, run in the project repository: aegean prepare --request FILE'];
  }
}

export function listSteps(states: string[]): string[] {
  const active = states.some(state => !['cancelled', 'archived', 'escalated'].includes(state));
  return active ? ['Inspect a run and its next step: aegean status --run ID'] : ['No run is active. A run exists only after you run this in the project repository: aegean prepare --request FILE'];
}
