import { z } from 'zod';
import { ModelExecutionSchema } from './model-policy.js';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { compareVersions, isStableVersion } from '../../scripts/cli-version.mjs';
export const GitHubLogin = z.string().min(1).max(39).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/).refine(login => !login.includes('--'));
export const ApproverSchema = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), login: GitHubLogin }).strict();
export type Approver = z.infer<typeof ApproverSchema>;
/** A project keeps the standard it was reviewed against. A release that changes the meaning of aegean.json raises the minimum. */
export function acceptsStandard(version: string, minimum: string = toolchain.minProjectStandard, current: string = toolchain.policy): boolean {
  return [version, minimum, current].every(isStableVersion) && compareVersions(version, minimum) >= 0 && compareVersions(version, current) <= 0;
}
export const ProjectSchema = z.object({
  schemaVersion: z.literal(2), standardVersion: z.string().refine(value => acceptsStandard(value), { message: `this release accepts project standards ${toolchain.minProjectStandard} to ${toolchain.policy}` }),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  approver: ApproverSchema, approvalMode: z.enum(['local', 'github-comments']).default('local'),
  modelExecution: ModelExecutionSchema.optional(),
  checks: z.array(z.array(z.string().min(1)).min(1)).min(1).max(20),
  verifier: z.object({ kind: z.literal('cli'), image: z.string().regex(/^[\w./:-]+@sha256:[a-f0-9]{64}$/), command: z.array(z.string().min(1)).min(1) }).strict(),
}).strict();
export type Project = z.infer<typeof ProjectSchema>;
export function assertSupportedImage(project: Project): void {
  if (project.verifier.image !== toolchain.verifier.image) throw new Error('project verifier image is not accepted by this release; prepare and review a compatible adapter before enrolment');
}
export const SuiteSchema = z.object({
  schemaVersion: z.literal(2), spec: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ input: z.string().max(8192), stdout: z.string().max(8192), exit: z.number().int().min(0).max(125), requirement: z.string().regex(/^R\d{3}$/) }).strict()).min(1).max(100),
}).strict();
export type Suite = z.infer<typeof SuiteSchema>;
/** The independent reviewer names the owner of each finding; the workflow routes the run from these owners. */
export const FINDING_OWNERS = ['builder', 'spec', 'factory'] as const;
export type FindingOwner = typeof FINDING_OWNERS[number];
export const ReviewSchema = z.object({ outcome: z.enum(['pass', 'repair', 'escalate']), findings: z.array(z.object({ owner: z.enum(FINDING_OWNERS), finding: z.string().max(1000) }).strict()).max(20) }).strict();
export type Review = z.infer<typeof ReviewSchema>;
