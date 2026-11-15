import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { digest } from '../domain/workflow.js';
import type { Approver } from '../domain/config.js';

export type DecisionAction = 'approve' | 'publish' | 'pilot' | 'revise' | 'migrate-control';
export interface HumanDecision {
  schemaVersion: 1; id: string; action: DecisionAction; run: string;
  actor: Approver; binding: string; decidedAt: number;
}
interface Terminal { input: Readable & { isTTY?: boolean }; output: Writable & { isTTY?: boolean } }

/**
 * Deliberate local interaction plus authenticated account identity. TTY is not
 * cryptographic evidence of a human: the operator/coordinator is trusted, and
 * agents must never answer this prompt on the operator's behalf.
 * There is no CLI yes flag, environment override or piped-input compatibility.
 */
export async function confirmHumanDecision(
  action: DecisionAction, run: string, summary: string, artifact: unknown,
  expected: Approver, authenticate: () => Promise<Approver>, signal?: AbortSignal,
  terminal: Terminal = { input: process.stdin, output: process.stdout },
): Promise<HumanDecision> {
  if (!terminal.input.isTTY || !terminal.output.isTTY) throw new Error('Human decision requires the operator at an interactive terminal; piped or unattended confirmation is refused');
  if (!/^[\w-]{1,128}$/.test(run) || Buffer.byteLength(summary) > 300_000) throw new Error('invalid or oversized decision review');
  const before = await authenticate();
  if (before.id !== expected.id) throw new Error('authenticated account differs from frozen approver');
  const binding = digest(JSON.stringify(artifact));
  const confirmation = `${action} ${run.slice(-8)}`;
  terminal.output.write(`${summary}\n\nApprover: ${before.login} (account ${before.id})\nArtifact identity: ${binding}\n`);
  const prompt = createInterface({ input: terminal.input, output: terminal.output });
  try {
    const answer = await prompt.question(`Type "${confirmation}" to ${action}, or anything else to cancel: `, signal ? { signal } : {});
    if (answer !== confirmation) throw new Error('Human decision cancelled; no authorization recorded');
    const after = await authenticate();
    if (after.id !== expected.id || after.id !== before.id) throw new Error('authenticated account changed during decision; authorization refused');
    if (digest(JSON.stringify(artifact)) !== binding) throw new Error('decision artifacts changed during confirmation');
    return { schemaVersion: 1, id: randomUUID(), action, run, actor: after, binding, decidedAt: Date.now() };
  } finally { prompt.close(); }
}

export function assertDecision(decision: HumanDecision, action: DecisionAction, run: string, artifact: unknown, approver: Approver): void {
  if (decision.schemaVersion !== 1 || decision.action !== action || decision.run !== run || decision.actor.id !== approver.id || decision.binding !== digest(JSON.stringify(artifact)) || !Number.isSafeInteger(decision.decidedAt) || decision.decidedAt <= 0) throw new Error('human authorization is stale or belongs to another run, artifact or approver');
}
