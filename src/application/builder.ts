import { ModelProfileSchema, type ModelProfile } from '../domain/model-policy.js';
import { toolOutputAllowance } from '../domain/context.js';
import { mkdir, mkdtemp, realpath, chmod, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command, type Result } from '../adapters/process.js';
import { subscriptionEnvironment, assertVersion } from '../adapters/agents.js';
import { builderCliPolicy } from '../adapters/builder-cli-policy.js';
import { startBuilderBridge } from '../adapters/builder-bridge.js';
import { BuilderSession, builderResource, cleanupBuilder, type BuilderResource } from '../adapters/builder-session.js';
import { captureProgram, parseSnapshot } from '../adapters/builder-snapshot.js';
import { importBuilderSnapshot, reconcileBuilderImport } from '../adapters/builder-import.js';
import { exportCommit } from '../adapters/verifier.js';
import { atomicJson, readJson } from '../adapters/files.js';
import { candidateGitChecked } from '../adapters/candidate-git.js';
import toolchain from '../../toolchain.json' with { type: 'json' };

const recordResource = (dir: string, resource: BuilderResource | null) => atomicJson(join(dir, 'builder-resource.json'), resource);
export async function reconcileBuilder(dir: string, worktree: string): Promise<void> {
  let resource: BuilderResource | null = null;
  try { resource = await readJson(join(dir, 'builder-resource.json')) as BuilderResource | null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (resource) {
    if (!await cleanupBuilder(resource)) throw new Error('Builder resources remain active or unknown; restore Docker and recover before resuming or releasing ownership');
    await recordResource(dir, null);
  }
  await reconcileBuilderImport(worktree, dir);
}

/** Subscription authentication stays in the host client. Candidate code never does. */
export async function containedBuilder(binary: string, prompt: string, worktree: string, dir: string, runId: string, timeoutMs: number, signal: AbortSignal, profile: ModelProfile = ModelProfileSchema.parse(toolchain.models.roles.builder.baseline), toolOutputBytes = toolchain.models.roles.builder.toolOutputBytes): Promise<Result> {
  ModelProfileSchema.parse(profile); if (profile.provider !== 'codex') throw new Error('Codex model required');
  const output = toolOutputAllowance(toolOutputBytes);
  const contextStop = new AbortController();
  const started = Date.now();
  const deadline = AbortSignal.any([signal, contextStop.signal, AbortSignal.timeout(Math.max(1, timeoutMs))]);
  const env = subscriptionEnvironment(process.env);
  let result: Result = { code: 1, stdout: '', stderr: '', durationMs: 0, interrupted: false };
  let session: BuilderSession | undefined;
  let bridge: Awaited<ReturnType<typeof startBuilderBridge>> | undefined;
  let hostDirectory: string | undefined;
  let resource: BuilderResource | undefined;
  try {
    await reconcileBuilder(dir, worktree);
    await assertVersion(binary, toolchain.codex);
    const before = await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: worktree, signal: deadline });
    if (await candidateGitChecked(['status', '--porcelain', '--', '.', ':(exclude).aegean-tmp'], { cwd: worktree, signal: deadline })) throw new Error('Builder requires a clean committed candidate; preserve edits and use revise');
    resource = builderResource(randomUUID());
    await mkdir(resource.seed, { recursive: true, mode: 0o755 }); await chmod(dirname(resource.seed), 0o755);
    await exportCommit(worktree, before, resource.seed, deadline);
    // Validate seed paths and types before exposing any bytes to the model/VM.
    // The fixed collector reads data only; it never imports candidate code.
    const seed = await command(process.execPath, ['--input-type=commonjs', '-e', captureProgram, resource.seed], { env, signal: deadline, timeoutMs: 15000, maxBytes: 145_000_000 });
    if (seed.code !== 0 || seed.interrupted) throw new Error('candidate seed does not satisfy the bounded Builder file policy');
    parseSnapshot(JSON.parse(seed.stdout));
    session = new BuilderSession(resource, value => recordResource(dir, value), command, toolchain.verifier.candidateRoot, deadline);
    await session.start();
    bridge = await startBuilderBridge(async input => { try { output.check(); const value = await session!.execute(input); output.consume(JSON.stringify(value)); return value; } catch (error) { contextStop.abort(); throw error; } });
    hostDirectory = await realpath(await mkdtemp(join(dir, 'builder-host-')));
    const policy = builderCliPolicy(bridge.command, bridge.args, hostDirectory);
    result = await command(binary, ['exec', '--model', profile.model, '-c', `model_reasoning_effort=${JSON.stringify(profile.effort)}`, '--ignore-user-config', '--strict-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--json', ...policy, '-C', hostDirectory, '-'], { cwd: hostDirectory, env, input: prompt, signal: deadline, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)), maxBytes: 4_000_000 });
    await bridge.close(); bridge = undefined;
    await atomicJson(join(dir, 'builder-context-usage.json'), output.status());
    if (output.status().exhausted) throw new Error('cumulative Builder tool output limit reached');
    if (deadline.aborted) throw new Error('Builder deadline or operator cancellation interrupted execution');
    if (result.code !== 0 || result.interrupted) return result;
    const snapshot = await session.finish();
    await importBuilderSnapshot(worktree, before, snapshot, dir, ['aegean.json', `openspec/changes/${runId}`], deadline);
    return result;
  } catch (error) {
    result = { ...result, code: 1, stderr: `${result.stderr}\n${String(error)}`.slice(-128_000), interrupted: deadline.aborted, ...(deadline.aborted ? { termination: signal.aborted ? 'aborted' as const : 'timeout' as const } : {}) };
    return result;
  } finally {
    try {
      await bridge?.close();
      // Cleanup ignores the aborted model deadline. Unknown daemon state throws
      // out of the role result, retaining both effect intent and run ownership.
      await session?.abort();
      if (resource && !session) await rm(dirname(resource.seed), { recursive: true, force: true });
    } finally {
      if (hostDirectory) await rm(hostDirectory, { recursive: true, force: true });
      result.durationMs = Date.now() - started;
    }
  }
}
