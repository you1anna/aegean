import { z } from 'zod';
export const ProjectSchema = z.object({
  schemaVersion: z.literal(1), standardVersion: z.literal('0.1.0'),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  checks: z.array(z.array(z.string().min(1)).min(1)).min(1).max(20),
  verifier: z.object({ kind: z.literal('cli'), image: z.string().regex(/^[\w./:-]+@sha256:[a-f0-9]{64}$/), command: z.array(z.string().min(1)).min(1) }).strict(),
}).strict();
export type Project = z.infer<typeof ProjectSchema>;
export const SuiteSchema = z.object({
  schemaVersion: z.literal(1), spec: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ input: z.string().max(8192), stdout: z.string().max(8192), exit: z.number().int().min(0).max(125), feedback: z.string().max(240) }).strict()).min(1).max(100),
}).strict();
export type Suite = z.infer<typeof SuiteSchema>;
export const ReviewSchema = z.object({ outcome: z.enum(['pass', 'repair', 'escalate']), findings: z.array(z.string().max(1000)).max(20) }).strict();
