import { join } from 'node:path';
import { candidateGit } from '../adapters/candidate-git.js';
import { atomicJson } from '../adapters/files.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import type { Receipt } from '../adapters/verifier.js';
import { ALLOWED_PATHS, outsideAllowedPaths, parseAllowedPaths } from '../domain/allowed-paths.js';
import { baselineReport, baselineSummary, type BaselineSummary } from '../domain/baseline.js';
import { digest } from '../domain/digest.js';
import type { BaselineCounts } from '../domain/run.js';
import type { Suite } from '../domain/config.js';

export const BASELINE = 'baseline.json';
interface BaselineRecord { schemaVersion: 1; suite: string; base: string; receipt: string; outcome: Receipt['outcome']; reason: string; summary: BaselineSummary }
export type BaselineDecision = { counts: BaselineCounts } | { pause: string; infrastructureFailure?: true };

export async function allowedPaths(specDir: string): Promise<string[]> {
  return parseAllowedPaths((await readBoundedEvidenceFile(join(specDir, ALLOWED_PATHS), 65_536)).toString('utf8'));
}

/** Paths that the candidate changes from the base and that the approved allowed paths do not cover. */
export async function pathsOutsideScope(worktree: string, base: string, commit: string, specDir: string, runId: string, signal?: AbortSignal): Promise<string[]> {
  const allowed = await allowedPaths(specDir);
  const listed = await candidateGit(['diff', '--name-only', '-z', '--no-renames', base, commit], { cwd: worktree, maxBytes: 1_000_000, ...(signal ? { signal } : {}) });
  if (listed.code !== 0 || listed.interrupted) throw new Error('cannot list the candidate changes for the allowed paths check');
  return outsideAllowedPaths(listed.stdout.split('\0').filter(Boolean), allowed, `openspec/changes/${runId}/`);
}

/** A failed verification that names the paths, so that the Builder can restore them in a repair. */
export function scopeReceipt(commit: string, spec: string, suite: string, image: string, outside: readonly string[], durationMs: number): Receipt {
  return { schemaVersion: 1, commit, spec, suite, image, outcome: 'fail', passed: 0, failed: 1, requirements: [], reason: 'outside-allowed-paths', durationMs, caseResults: [], outsidePaths: outside.slice(0, 20).map(path => path.slice(0, 200)) };
}

/** Records the protected suite results on the base commit and decides whether the Builder may start. */
export async function recordBaseline(dir: string, suiteDigest: string, base: string, suite: Suite, receipt: Receipt): Promise<BaselineDecision> {
  const path = join(dir, BASELINE);
  const complete = receipt.outcome === 'pass' || (receipt.outcome === 'fail' && receipt.reason !== 'candidate-rejected');
  const summary = baselineSummary(suite.cases.map(item => item.requirement), complete ? receipt.caseResults : []);
  await atomicJson(path, { schemaVersion: 1, suite: suiteDigest, base, receipt: digest(JSON.stringify(receipt)), outcome: receipt.outcome, reason: receipt.reason, summary } satisfies BaselineRecord);
  if (receipt.retainedResources) return { pause: `Verifier cleanup failed during the base commit check; the resources are recorded in ${path}; restore Docker before resume` };
  if (receipt.outcome === 'cancelled') return { pause: 'Base commit check cancelled by operator' };
  if (receipt.outcome === 'inconclusive') return { pause: `Base commit check inconclusive (${receipt.reason}); restore the verifier, then resume`, infrastructureFailure: true };
  if (!complete) return { pause: `The base commit cannot run in the verifier (${receipt.reason}); inspect ${path}` };
  return { counts: { suite: suiteDigest, cases: summary.cases, passed: summary.passed } };
}

/** The recorded base commit results for this suite, as text for the human; nothing for another suite. */
export async function baselineText(dir: string, suiteDigest: string | undefined): Promise<string | undefined> {
  if (!suiteDigest) return undefined;
  try {
    const record = JSON.parse((await readBoundedEvidenceFile(join(dir, BASELINE), 65_536)).toString('utf8')) as BaselineRecord;
    return record.suite === suiteDigest ? baselineReport(record.summary) : undefined;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
