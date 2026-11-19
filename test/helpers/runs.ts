import { randomUUID } from 'node:crypto';
import { createRun, type Event, type EventType, type Run } from '../../src/domain/run.js';
import { digest } from '../../src/domain/digest.js';
import { POLICY } from '../../src/domain/workflow-policy.js';

/** Synthetic values that a run freezes at creation. Each call returns a new object that a test can change. */
export const frozenProject = () => ({ approver: { id: 42, login: 'reviewer' }, projectPolicy: digest('frozen project policy') });

export interface RunOptions { id?: string; host?: string; repository?: string; now?: number; frozen?: ReturnType<typeof frozenProject> }
/** A new run under the installed policy, with synthetic identity values. */
export function syntheticRun(options: RunOptions = {}): Run {
  return createRun(options.id ?? 'run-1', options.host ?? 'host-a', options.repository ?? 'owner/repo', POLICY.version, options.now ?? 100, options.frozen ?? frozenProject());
}

/** A workflow event with a new identity. The data is not checked, so a test can send an invalid event. */
export const workflowEvent = (type: EventType, data: Record<string, unknown> = {}, at = 101): Event =>
  ({ id: randomUUID(), at, type, ...data } as Event);
