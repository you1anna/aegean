import { identity } from './digest.js';
import { z } from 'zod';

export const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().min(1).max(512).refine(value => !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..') && !/[\\\0\r\n]/.test(value));
export const TaskScopeSchema = z.object({
  class: z.enum(['unknown', 'routine-cli']), paths: z.array(path).max(100), dependencies: z.array(path).max(100),
  concerns: z.array(z.enum(['security', 'permissions', 'persistence', 'concurrency', 'migration', 'workflow'])).max(6),
}).strict();
export type TaskScope = z.infer<typeof TaskScopeSchema>;
export const unknownTask: TaskScope = { class: 'unknown', paths: [], dependencies: [], concerns: [] };
export const TokenPolicySchema = z.object({ enforcement: z.enum(['monitored', 'strict']), maxTokensPerRun: safeInteger.positive(), maxTokensPerCall: safeInteger.positive() }).strict()
  .refine(p => p.maxTokensPerCall <= p.maxTokensPerRun, 'call allowance exceeds run allowance');
export type TokenPolicy = z.infer<typeof TokenPolicySchema>;
export const ModelExecutionSchema = z.object({ budget: TokenPolicySchema, task: TaskScopeSchema }).strict();
export const ModelProfileSchema = z.object({ provider: z.enum(['claude', 'codex']), model: z.string().regex(/^(claude-|gpt-)[a-z0-9.-]+$/), effort: z.enum(['low', 'medium', 'high']) }).strict()
  .refine(p => p.model.startsWith(p.provider === 'claude' ? 'claude-' : 'gpt-'), 'model provider differs');
export type ModelProfile = z.infer<typeof ModelProfileSchema>;
const observation = z.object({ tokens: safeInteger.positive().nullable(), passed: z.boolean(), missedRequirements: safeInteger, acceptedDefects: safeInteger }).strict();
const QualificationSchema = z.object({ taskClass: z.literal('routine-cli'), identity: hash, manifest: hash, pairs: z.array(z.object({ fixture: z.string().min(1).max(128), attempt: z.number().int().min(1).max(3), baseline: observation, candidate: observation }).strict()).min(30).max(3000) }).strict();
export type Qualification = z.infer<typeof QualificationSchema>;
const RolePolicySchema = z.object({ baseline: ModelProfileSchema, candidate: ModelProfileSchema.optional(), qualification: QualificationSchema.optional(), inputBytes: safeInteger.positive().max(1_000_000), toolOutputBytes: safeInteger.positive().max(4_000_000) }).strict();
export type RolePolicy = z.infer<typeof RolePolicySchema>;
export const ModelPolicySchema = z.object({ schemaVersion: z.literal(1), roles: z.object({ scout: RolePolicySchema, builder: RolePolicySchema, 'auditor-tests': RolePolicySchema, 'auditor-review': RolePolicySchema }).strict() }).strict().superRefine((policy, ctx) => {
  for (const [role, value] of Object.entries(policy.roles)) {
    const provider = role === 'builder' ? 'codex' : 'claude';
    if (value.baseline.provider !== provider || value.candidate && value.candidate.provider !== provider) ctx.addIssue({ code: 'custom', message: 'role provider differs' });
    if (role.startsWith('auditor') && (value.candidate || value.qualification)) ctx.addIssue({ code: 'custom', message: 'Auditors retain the baseline' });
  }
});
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
export type ModelRole = keyof ModelPolicy['roles'];
export interface QualificationPins { policy: string; maxRepairs: number; maxRevisions: number; maxModelCalls: number; activeTimeoutMs: number; claude: string; codex: string }
export function qualificationPolicyIdentity(policy: ModelPolicy, pins: QualificationPins): string {
  return identity({ workflow: pins.policy, contextPolicy: 'required-first-v1', taskClass: 'routine-cli', maxRepairs: pins.maxRepairs, maxRevisions: pins.maxRevisions, maxModelCalls: pins.maxModelCalls, activeTimeoutMs: pins.activeTimeoutMs, auditorCli: pins.claude, testAuditor: policy.roles['auditor-tests'], reviewAuditor: policy.roles['auditor-review'] });
}
export function qualificationIdentity(role: RolePolicy, cli: string, policyIdentity: string): string {
  return identity({ baseline: role.baseline, candidate: role.candidate, inputBytes: role.inputBytes, toolOutputBytes: role.toolOutputBytes, cli, policyIdentity, taskClass: 'routine-cli' });
}
export function qualifies(role: RolePolicy, cli: string, policyIdentity: string): boolean {
  const parsed = QualificationSchema.safeParse(role.qualification);
  if (!role.candidate || !parsed.success || parsed.data.identity !== qualificationIdentity(role, cli, policyIdentity)) return false;
  const report = parsed.data; const fixtures = new Map<string, Set<number>>();
  const baseline: number[] = []; const candidate: number[] = [];
  for (const pair of report.pairs) {
    const attempts = fixtures.get(pair.fixture) ?? new Set<number>();
    if (attempts.has(pair.attempt)) return false;
    attempts.add(pair.attempt); fixtures.set(pair.fixture, attempts);
    const a = pair.baseline, b = pair.candidate;
    if (a.tokens === null || b.tokens === null || a.passed && !b.passed || b.missedRequirements || b.acceptedDefects) return false;
    // Only paired successful tasks establish savings; all attempts still need usage.
    if (a.passed && b.passed) { baseline.push(a.tokens); candidate.push(b.tokens); }
  }
  if (fixtures.size < 10 || [...fixtures.values()].some(attempts => attempts.size !== 3) || baseline.length !== report.pairs.length) return false;
  baseline.sort((a, b) => a - b); candidate.sort((a, b) => a - b);
  const percentile = (values: number[], fraction: number) => values[Math.ceil(values.length * fraction) - 1]!;
  return percentile(candidate, .5) <= percentile(baseline, .5) * .8 && percentile(candidate, .95) <= percentile(baseline, .95);
}
export function routineTask(task: TaskScope): boolean {
  const scope = TaskScopeSchema.parse(task);
  return scope.class === 'routine-cli' && scope.paths.length > 0 && scope.concerns.length === 0
    && ![...scope.paths, ...scope.dependencies].some(p => /(^|[\/_.-])(auth|security|permission|storage|database|migration|concurrency|workflow|policy|ledger|lock|secret)([\/_.-]|$)|(^|\/)(\.github|\.agents|\.codex)(\/|$)|(^|\/)(AGENTS|CLAUDE)\.md$/.test(p));
}
export function selectModel(policy: ModelPolicy, role: ModelRole, task: TaskScope, repairs: number, cli: QualificationPins): ModelProfile {
  const validated = ModelPolicySchema.parse(policy); const selected = validated.roles[role];
  if (!Number.isSafeInteger(repairs) || repairs < 0) throw new Error('invalid repair count');
  return selected.candidate && !role.startsWith('auditor') && repairs === 0 && routineTask(task) && qualifies(selected, cli[selected.baseline.provider], qualificationPolicyIdentity(validated, cli)) ? selected.candidate : selected.baseline;
}
