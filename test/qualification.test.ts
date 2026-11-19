import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { command, type Options, type Result } from '../src/adapters/process.js';
import { runQualificationProbes, qualificationToolCheckIds, qualificationVmCheckIds } from '../src/adapters/qualification-probes.js';
import { qualificationCoordinator } from '../src/application/qualification.js';
import { builderResource } from '../src/adapters/builder-session.js';
import { digest } from '../src/domain/digest.js';
import { POLICY_IDENTITY } from '../src/domain/workflow-policy.js';
import toolchain from '../toolchain.json' with { type: 'json' };

const result = (fields: Partial<Result> = {}): Result => ({ code: 0, stdout: '', stderr: '', durationMs: 1, interrupted: false, ...fields });
async function fixture(body: (root: string, execute: typeof command, controls: { tools: Record<string, unknown>; vm: Record<string, unknown>; negativePasses: boolean; calls: { file: string; args: readonly string[]; options?: Options }[] }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'aegean-qualification-test-')); const original = toolchain.verifier.candidateRoot;
  toolchain.verifier.candidateRoot = join(root, 'exports');
  try {
    await mkdir(join(root, 'scripts')); await mkdir(join(root, 'dist/src/adapters'), { recursive: true });
    for (const name of ['probe-builder-tools.mjs', 'probe-builder-vm.mjs']) await cp(join('scripts', name), join(root, 'scripts', name));
    await writeFile(join(root, 'dist/src/adapters/verifier.js'), 'synthetic adapter identity');
    const controls = { tools: { status: 'passed', report: '/synthetic-not-ingested.json', checks: qualificationToolCheckIds.map(id => ({ id, status: 'passed' })) } as Record<string, unknown>, vm: { schemaVersion: 1, synthetic: true, acceptance: false, checks: qualificationVmCheckIds.map(name => ({ name, passed: true })), reportPath: '/synthetic-not-ingested.json' } as Record<string, unknown>, negativePasses: false, calls: [] as { file: string; args: readonly string[]; options?: Options }[] };
    const execute: typeof command = async (file, args, options = {}) => {
      controls.calls.push({ file, args, options });
      if (file === 'git') return command(file, args, options);
      if (file === process.execPath) {
        if (args[0]!.endsWith('probe-builder-vm.mjs')) { await mkdir(args[2]!, { recursive: true }); await writeFile(join(args[2]!, 'resource.json'), 'null'); }
        return result({ stdout: JSON.stringify(args[0]!.endsWith('probe-builder-tools.mjs') ? controls.tools : controls.vm) });
      }
      assert.equal(file, 'docker');
      const operation = args[2];
      if (operation === 'image' || operation === 'rm') return result();
      if (operation === 'run') {
        if (args.includes('--check')) return result();
        const mount = args[args.indexOf('--mount') + 1]!; const candidate = /^type=bind,src=(.*),dst=\/candidate,readonly$/.exec(mount)![1]!;
        const program = await readFile(join(candidate, 'app.cjs'), 'utf8');
        const output = program.includes("'BROKEN'") && !controls.negativePasses ? 'BROKEN' : options.input!.trim().toUpperCase();
        return result({ stdout: `DENIED:${output}\n` });
      }
      throw new Error(`Unexpected synthetic process: ${file} ${args.join(' ')}`);
    };
    await body(root, execute, controls);
  } finally { toolchain.verifier.candidateRoot = original; await rm(root, { recursive: true, force: true }); }
}

test('qualification maps exact native controls and runs broken/repaired candidates through the actual verifier adapter', async () => fixture(async (root, execute, controls) => {
  const observed = await runQualificationProbes(root, new AbortController().signal, { execute });
  assert.ok(observed.builder.observations.every(item => item.outcome === 'pass'));
  assert.ok(observed.verifier.observations.every(item => item.outcome === 'pass'));
  assert.equal(observed.cleanupConfirmed, true);
  const native = controls.calls.filter(call => call.file === process.execPath);
  assert.equal(native.length, 2); assert.equal(native[0]!.args[0], join(root, 'scripts/probe-builder-tools.mjs')); assert.equal(native[0]!.args[1], '--codex');
  assert.equal(native[1]!.args[1], '--report-root');
  assert.equal(controls.calls.filter(call => call.file === 'docker' && call.args[2] === 'run').length, 6);
  assert.match(observed.builder.source.evidenceHash, /^[a-f0-9]{64}$/);
  assert.ok(observed.limitations.some(item => item.includes('synthetic')));
  await rm(observed.workDirectory, { recursive: true, force: true });
}));

test('generic exit zero, missing controls and duplicate or unknown IDs never become passing native evidence', async () => fixture(async (root, execute, controls) => {
  const original = structuredClone(controls.tools);
  for (const malformed of [{}, { ...original, checks: [{ id: 'invented', status: 'passed' }] }, { ...original, checks: [...original.checks as object[], (original.checks as object[])[0]!] }]) {
    controls.tools = malformed;
    const observed = await runQualificationProbes(root, new AbortController().signal, { execute });
    assert.ok(observed.builder.observations.some(item => item.outcome === 'unknown'));
    await rm(observed.workDirectory, { recursive: true, force: true });
  }
  controls.tools = original; controls.vm.checks = (controls.vm.checks as { name: string }[]).filter(item => item.name !== 'cancellation-contained');
  const incomplete = await runQualificationProbes(root, new AbortController().signal, { execute });
  assert.equal(incomplete.builder.observations.find(item => item.name === 'cancellation-contained')!.outcome, 'unknown');
  await rm(incomplete.workDirectory, { recursive: true, force: true });
}));

test('explicit native failures remain failed and a broken candidate that passes invalidates the protected negative control', async () => fixture(async (root, execute, controls) => {
  controls.vm.checks = (controls.vm.checks as { name: string; passed: boolean }[]).map(item => ({ ...item, passed: item.name !== 'networkDenied' })); controls.negativePasses = true;
  const observed = await runQualificationProbes(root, new AbortController().signal, { execute });
  assert.equal(observed.builder.observations.find(item => item.name === 'network-denied')!.outcome, 'fail');
  assert.equal(observed.verifier.observations.find(item => item.name === 'negative-control')!.outcome, 'fail');
  await rm(observed.workDirectory, { recursive: true, force: true });
}));

test('interrupted VM probes reconcile only their recorded resource and never count interruption as a pass', async () => fixture(async (root, execute) => {
  const expected = builderResource(randomUUID()); let cleaned = false;
  const interrupted: typeof command = async (file, args, options) => {
    if (file === process.execPath && args[0]!.endsWith('probe-builder-vm.mjs')) {
      await mkdir(args[2]!, { recursive: true }); await writeFile(join(args[2]!, 'resource.json'), JSON.stringify(expected));
      return result({ code: 128, interrupted: true, termination: 'aborted' });
    }
    return execute(file, args, options);
  };
  const observed = await runQualificationProbes(root, new AbortController().signal, { execute: interrupted, cleanupBuilder: async resource => { assert.deepEqual(resource, expected); cleaned = true; return true; } });
  assert.equal(cleaned, true); assert.ok(observed.builder.observations.some(item => item.outcome === 'unknown'));
  await rm(observed.workDirectory, { recursive: true, force: true });
}));

test('unknown Builder cleanup stops further candidate execution and preserves its intent', async () => fixture(async (root, execute, controls) => {
  const resource = builderResource(randomUUID());
  const interrupted: typeof command = async (file, args, options) => {
    if (file === process.execPath && args[0]!.endsWith('probe-builder-vm.mjs')) {
      await mkdir(args[2]!, { recursive: true }); await writeFile(join(args[2]!, 'resource.json'), JSON.stringify(resource));
      return result({ code: 128, interrupted: true, termination: 'timeout' });
    }
    return execute(file, args, options);
  };
  const observed = await runQualificationProbes(root, new AbortController().signal, { execute: interrupted, cleanupBuilder: async () => false });
  assert.equal(observed.cleanupConfirmed, false); assert.equal(observed.retainedResources.length, 1);
  assert.ok(observed.verifier.observations.every(item => item.outcome === 'unknown'));
  assert.equal(controls.calls.filter(call => call.file === 'docker').length, 0);
  assert.deepEqual(JSON.parse(await readFile(observed.retainedResources[0]!, 'utf8')), resource);
  await rm(observed.workDirectory, { recursive: true, force: true });
}));

test('observed oracle exposure is a failure rather than an unavailable probe', async () => fixture(async (root, execute) => {
  const exposed: typeof command = async (file, args, options) => {
    const response = await execute(file, args, options);
    return file === 'docker' && args[2] === 'run' && !args.includes('--check') ? { ...response, stdout: 'EXPOSED:ALPHA\n' } : response;
  };
  const observed = await runQualificationProbes(root, new AbortController().signal, { execute: exposed });
  assert.equal(observed.verifier.observations.find(item => item.name === 'oracle-isolation')!.outcome, 'fail');
  await rm(observed.workDirectory, { recursive: true, force: true });
}));

test('qualification coordinator refuses artifact drift before recording and records honest unknowns without acceptance', async () => {
  const identity = { sourceCommit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), buildHash: 'c'.repeat(64), artifactHash: 'd'.repeat(64), nodeHash: 'e'.repeat(64), policyIdentity: POLICY_IDENTITY, image: toolchain.verifier.image };
  const at = Date.now(); const source = { kind: 'native-harness' as const, name: 'builder-containment-v1', startedAt: at, finishedAt: at, evidenceHash: digest('explicit synthetic fixture') };
  const fixtureReport = { workDirectory: '/synthetic', cleanupConfirmed: true, retainedResources: [] as string[], limitations: ['synthetic injected test'], builder: { source, observations: [{ name: 'outside-read-denied', outcome: 'unknown' as const, observedAt: at, detail: 'probe unavailable' }] }, verifier: { source: { ...source, name: 'protected-verifier-v1' }, observations: [{ name: 'negative-control', outcome: 'unknown' as const, observedAt: at }] } };
  let reads = 0; let records = 0;
  const qualify = qualificationCoordinator({ identity: async () => ++reads === 1 ? identity : { ...identity, artifactHash: '0'.repeat(64) }, probes: async () => fixtureReport, record: async () => { records++; return { path: 'acceptance-evidence/fixture.json', hash: 'f'.repeat(64) }; } });
  await assert.rejects(qualify('/synthetic', '/synthetic-state', randomUUID(), new AbortController().signal), /changed|drift/); assert.equal(records, 0);
  const truthful = qualificationCoordinator({ identity: async () => identity, probes: async () => fixtureReport, record: async () => { records++; return { path: 'acceptance-evidence/fixture.json', hash: 'f'.repeat(64) }; } });
  const summary = await truthful('/synthetic', '/synthetic-state', randomUUID(), new AbortController().signal);
  assert.equal(summary.prerequisitesPassed, false); assert.equal(summary.acceptanceWritten, false); assert.equal(records, 2);
  await assert.rejects(truthful('/synthetic', '/synthetic-state', randomUUID(), AbortSignal.abort())); assert.equal(records, 2);
});
