import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { fixture } from './helpers/coordinator.js';
import { command } from '../src/adapters/process.js';
import { digest } from '../src/domain/workflow.js';
import { defaultBudget } from '../src/domain/budgets.js';

// Test-only coordinator edge. No unattended production flag or environment bypass.
async function decision(f: Awaited<ReturnType<typeof fixture>>, action: string, options = {}, during = '') {
  const id = (await f.current()).id;
  const script = `import {decisionCoordinator} from ${JSON.stringify(pathToFileURL(join(f.root, 'dist/src/application/decision-commands.js')).href)};
import {digest} from ${JSON.stringify(pathToFileURL(join(f.root, 'dist/src/domain/workflow.js')).href)};
import {randomUUID} from 'node:crypto';
const confirm=async(action,run,summary,artifact,actor,authenticate)=>{ await authenticate(); ${during}; return {schemaVersion:1,id:randomUUID(),action,run,actor,binding:digest(JSON.stringify(artifact)),decidedAt:Date.now()}; };
console.log(JSON.stringify(await decisionCoordinator(confirm)(${JSON.stringify(f.root)},${JSON.stringify(id)},${JSON.stringify(action)},${JSON.stringify(options)},new AbortController().signal)));`;
  return command(process.execPath, ['--input-type=module', '-e', script], { cwd: f.repo, env: f.env, timeoutMs: 120000 });
}
const ok = (result: {code: number; stderr: string}) => assert.equal(result.code, 0, result.stderr);

test('local approvals, exact publication, implementation and contract revisions complete a synthetic lifecycle', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    const acceptedBefore = await readFile(join(f.state, 'acceptance.json'), 'utf8');
    ok(await f.start()); assert.equal((await f.current()).state, 'spec-drafted');
    assert.equal((await f.events()).some(e => e.effect === 'pr-create'), false);
    const piped = await f.cli(['approve', '--run', (await f.current()).id]); assert.notEqual(piped.code, 0); assert.match(piped.stderr, /interactive terminal/);
    ok(await decision(f, 'approve')); await f.scenario({ verifierFailOnce: true }); ok(await f.resume()); assert.equal((await f.current()).state, 'human-merge-review');
    assert.equal((await f.current()).repairs, 1); await f.scenario({});
    const local = await f.local(); await writeFile(join(local.worktree, 'note.txt'), 'implementation revision'); await f.realGit(['add', '.'], local.worktree); await f.realGit(['commit', '-m', 'revision'], local.worktree);
    ok(await decision(f, 'revise', { scope: 'implementation' }));
    const revised = await f.current(); assert.equal(revised.state, 'verifying'); assert.equal(revised.receipt, undefined); assert.equal(revised.publicationRef, undefined);
    ok(await f.resume()); assert.equal((await f.current()).state, 'human-merge-review');
    const spec = join(local.worktree, 'openspec/changes', revised.id, 'proposal.md'); await writeFile(spec, await readFile(spec, 'utf8') + '\nClarify contract.\n');
    await f.realGit(['add', '.'], local.worktree); await f.realGit(['commit', '-m', 'contract revision'], local.worktree);
    assert.notEqual((await decision(f, 'revise', { scope: 'implementation' })).code, 0);
    ok(await decision(f, 'revise', { scope: 'contract' })); assert.equal((await f.current()).suite, undefined);
    ok(await decision(f, 'approve')); ok(await f.resume());
    ok(await decision(f, 'publish')); await f.scenario({ pushAfter: 'candidate', prCreateAfter: true });
    const uncertain = await f.resume(); assert.notEqual(uncertain.code, 0);
    await f.scenario({}); ok(await f.resume());
    assert.equal((await f.events()).filter(e => e.effect === 'pr-create').length, 1);
    await f.scenario({ merged: true }); await f.merge(); ok(await f.resume()); assert.equal((await f.current()).state, 'archived');
    assert.equal(await readFile(join(f.state, 'acceptance.json'), 'utf8'), acceptedBefore);
    const evidence = JSON.parse(await readFile(join(f.state, 'runs', revised.id, 'evidence-receipts.json'), 'utf8'));
    assert.equal(evidence.references.length, 0); // ordinary runs do not replace release qualification
    const status = await f.cli(['doctor']); ok(status); assert.equal(JSON.parse(status.stdout).fullWorkflowReady, true);
  } finally { await f.cleanup(); }
});

test('pilot refuses missing authorization and expiry; call cap rejects execution without resetting on resume', async () => {
  const f = await fixture({ approvalMode: 'local', prerequisitesOnly: true });
  try {
    const start = await f.start(); assert.notEqual(start.code, 0); assert.match(start.stderr, /Pilot authorization required/);
    assert.equal((await f.events()).filter(e => e.role).length, 0);
    const opts = { expiresAt: Date.now() + 600_000, budget: { ...defaultBudget, maxModelCalls: 1 } };
    ok(await decision(f, 'pilot', opts)); ok(await f.resume()); ok(await decision(f, 'approve'));
    const exhausted = await f.resume(); assert.notEqual(exhausted.code, 0); assert.match(exhausted.stderr, /usage budget exhausted/);
    assert.equal((await f.events()).filter(e => e.role).length, 1);
    const file = join(f.state, 'runs', (await f.current()).id, 'pilot.json'); const saved = await readFile(file, 'utf8');
    // A repeated identical request reports the saved decision without a new human prompt; nothing is replaced or reset.
    const repeated = await decision(f, 'pilot', opts, 'throw new Error("unexpected human prompt")'); ok(repeated);
    assert.equal(JSON.parse(repeated.stdout).alreadyAuthorized, true); assert.match(JSON.parse(repeated.stdout).action, /aegean resume --run/);
    const replaced = await decision(f, 'pilot', { ...opts, budget: { ...defaultBudget, maxModelCalls: 2 } });
    assert.notEqual(replaced.code, 0); assert.match(replaced.stderr, /different limits; it cannot be replaced/);
    assert.equal(await readFile(file, 'utf8'), saved);
    const record = JSON.parse(saved);
    record.artifact.expiresAt = Date.now() - 1; record.decision.decidedAt = record.artifact.expiresAt - 1;
    record.decision.binding = digest(JSON.stringify(record.artifact)); // synthetic fixture models an honestly expired decision
    await writeFile(file, JSON.stringify(record));
    const expired = await f.resume(); assert.notEqual(expired.code, 0); assert.match(expired.stderr, /expired/); assert.equal((await f.events()).filter(e => e.role).length, 1);
    const guided = JSON.parse((await f.cli(['status', '--run', (await f.current()).id])).stdout);
    assert.match(guided.next[0], /pilot authorisation expired at .* It cannot be replaced/); assert.equal(guided.pilot.budget.maxModelCalls, 1);
    const late = await decision(f, 'pilot', { ...opts, expiresAt: record.artifact.expiresAt }); assert.notEqual(late.code, 0); assert.match(late.stderr, /expired at .*cannot be replaced/);
  } finally { await f.cleanup(); }
});

test('identity changes during local review invalidate the decision and release capacity', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    ok(await f.start());
    const changed = await decision(f, 'approve', {}, `await import('node:fs/promises').then(fs=>fs.appendFile(${JSON.stringify(join((await f.local()).worktree, 'aegean.json'))},' '))`);
    assert.notEqual(changed.code, 0); assert.match(changed.stderr, /policy changed/);
    assert.equal((await f.current()).state, 'spec-drafted'); assert.deepEqual((await f.ledger()).repositories, {});
  } finally { await f.cleanup(); }
});

test('explicit recovery settles an orphan usage reservation once and never resets its charge', async () => {
  const f = await fixture({ approvalMode: 'local', prerequisitesOnly: true });
  try {
    assert.notEqual((await f.start()).code, 0);
    ok(await decision(f, 'pilot', { expiresAt: Date.now() + 600_000, budget: defaultBudget }));
    ok(await f.resume()); const run = await f.current(); const path = join(f.state, 'runs', run.id, 'model-budget.json');
    const budget = JSON.parse(await readFile(path, 'utf8')); budget.reservations.orphan = { ...Object.values(budget.reservations)[0] as object, timeoutMs: 1234 }; delete budget.reservations.orphan.durationMs; delete budget.reservations.orphan.consumed; await writeFile(path, JSON.stringify(budget));
    ok(await f.cli(['recover', '--run', run.id, '--confirm-stopped']));
    const first = await f.current(); assert.equal(first.state, 'paused');
    const charged = JSON.parse(await readFile(path, 'utf8')); assert.equal(charged.reservations.orphan.durationMs, 1234);
    ok(await f.cli(['recover', '--run', run.id, '--confirm-stopped']));
    assert.deepEqual(await f.current(), first); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), charged);
    assert.equal((await f.events()).filter(e => e.role).length, 1);
    const receipts = JSON.parse(await readFile(join(f.state, 'runs', run.id, 'evidence-receipts.json'), 'utf8'));
    const receipt = JSON.parse(await readFile(join(f.state, receipts.references[0].path), 'utf8'));
    assert.equal(receipt.outcome, 'unknown'); // unexercised recovery controls cannot be invented
  } finally { await f.cleanup(); }
});

test('publication refuses changed push destinations on decision and resume; control migration is idempotent', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    ok(await f.start()); ok(await decision(f, 'approve')); ok(await f.resume());
    const local = await f.local();
    await f.realGit(['config', 'remote.origin.pushurl', 'git@github.com:wrong/project.git'], local.worktree);
    const refused = await decision(f, 'publish'); assert.notEqual(refused.code, 0); assert.match(refused.stderr, /destinations/);
    await f.realGit(['config', '--unset', 'remote.origin.pushurl'], local.worktree);
    ok(await decision(f, 'publish'));
    await f.realGit(['config', 'remote.origin.pushurl', 'git@github.com:wrong/project.git'], local.worktree);
    const resumed = await f.resume(); assert.notEqual(resumed.code, 0); assert.match(resumed.stderr, /destinations/);
    assert.equal((await f.events()).some(e => e.effect === 'pr-create'), false);
    await f.realGit(['config', '--unset', 'remote.origin.pushurl'], local.worktree);
    const migration = await f.cli(['migrate-control', '--approver', 'fixture']); ok(migration); assert.equal(JSON.parse(migration.stdout).migrated, false);
  } finally { await f.cleanup(); }
});

test('cancellation releases confirmed-quiescent ownership even when optional evidence is corrupt', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    ok(await f.start()); const id = (await f.current()).id;
    await writeFile(join(f.state, 'runs', id, 'observations.json'), '{');
    const cancelled = await f.cli(['cancel', '--run', id]); ok(cancelled);
    assert.match(JSON.parse(cancelled.stdout).evidenceWarning, /Cancellation completed/);
    assert.equal((await f.current()).state, 'cancelled'); assert.deepEqual((await f.ledger()).owners, {}); assert.deepEqual((await f.ledger()).repositories, {});
  } finally { await f.cleanup(); }
});

test('expired pilot cannot archive after human merge or generate passing final receipts', async () => {
  const f = await fixture({ approvalMode: 'local', prerequisitesOnly: true });
  try {
    assert.notEqual((await f.start()).code, 0);
    ok(await decision(f, 'pilot', { expiresAt: Date.now() + 600_000, budget: defaultBudget }));
    ok(await f.resume()); ok(await decision(f, 'approve')); ok(await f.resume());
    ok(await decision(f, 'publish')); ok(await f.resume());
    const id = (await f.current()).id;
    const path = join(f.state, 'runs', id, 'pilot.json'); const record = JSON.parse(await readFile(path, 'utf8'));
    record.artifact.expiresAt = Date.now() - 1; record.decision.decidedAt = record.artifact.expiresAt - 1;
    record.decision.binding = digest(JSON.stringify(record.artifact)); await writeFile(path, JSON.stringify(record));
    await f.scenario({ merged: true }); await f.merge();
    const resumed = await f.resume(); assert.notEqual(resumed.code, 0); assert.match(resumed.stderr, /expired/);
    assert.equal((await f.events()).filter(e => e.effect === 'push' && e.kind === 'archive').length, 0);
    const script = `import {finalizeRunEvidence} from ${JSON.stringify(pathToFileURL(join(f.root, 'dist/src/application/run-evidence.js')).href)};
await finalizeRunEvidence(${JSON.stringify(f.root)},${JSON.stringify(join(f.state, 'runs', id))},${JSON.stringify(await f.current())});`;
    ok(await command(process.execPath, ['--input-type=module', '-e', script], { env: f.env }));
    const receipts = JSON.parse(await readFile(join(f.state, 'runs', id, 'evidence-receipts.json'), 'utf8'));
    for (const reference of receipts.references) assert.notEqual(JSON.parse(await readFile(join(f.state, reference.path), 'utf8')).outcome, 'pass');
  } finally { await f.cleanup(); }
});

test('durable status survives absent and incompatible local accounting', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    ok(await f.start()); const id = (await f.current()).id;
    const path = join(f.state, 'runs', id, 'model-budget.json');
    const original = JSON.parse(await readFile(path, 'utf8'));
    for (const value of [{ ...original, policyIdentity: 'a'.repeat(64) }, null]) {
      if (value) await writeFile(path, JSON.stringify(value)); else await (await import('node:fs/promises')).rm(path);
      const result = await f.cli(['status', '--run', id]); ok(result);
      assert.equal(JSON.parse(result.stdout).state, 'spec-drafted'); assert.equal(JSON.parse(result.stdout).usage.available, false);
      assert.notEqual((await f.resume()).code, 0);
    }
  } finally { await f.cleanup(); }
});

test('Scout reads ignore rules; the draft stop gives review notes, the specification path and the next step', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    await writeFile(join(f.repo, '.gitignore'), 'data/\n'); await f.realGit(['add', '.']); await f.realGit(['commit', '-m', 'ignore rules']); await f.realGit(['push', 'origin', 'main']);
    const preview = await f.cli(['project', 'check']); ok(preview);
    const context = JSON.parse(preview.stdout).agentContext;
    assert.ok(context.files.some((file: {path: string; required: boolean}) => file.path === '.gitignore' && file.required)); assert.ok(context.bytes <= context.limitBytes);
    assert.equal((await f.runDirs().catch(() => [])).length, 0); // the preview allocates no run
    const started = await f.start(); ok(started); const out = JSON.parse(started.stdout); const id = (await f.current()).id;
    const contexts = join(f.state, 'runs', id, 'contexts'); const source = (await readdir(contexts)).find(name => name.endsWith('-source.json'))!;
    assert.ok(JSON.parse(await readFile(join(contexts, source), 'utf8')).manifest.some((part: {path: string; included: boolean}) => part.path === '.gitignore' && part.included));
    const notes = await readFile(join(out.specification, 'review-notes.md'), 'utf8');
    assert.match(notes, /## Project rules that limited the request\n\nNone reported\./); assert.match(notes, /- Synthetic open question/);
    assert.deepEqual(out.review, { projectRulesThatLimitedTheRequest: [], openQuestions: ['Synthetic open question'], notCovered: [] });
    assert.ok(out.next.some((step: string) => step.includes(`aegean approve --run ${id}`)));
    const status = JSON.parse((await f.cli(['status', '--run', id])).stdout);
    assert.equal(status.specification, out.specification); assert.match(status.next[0], /review-notes\.md/);
    assert.match(JSON.parse((await f.cli(['status'])).stdout).next[0], /aegean status --run ID/);
    // A second resume keeps the reviewed notes inside the frozen specification.
    ok(await f.resume()); assert.equal((await f.current()).spec, status.spec);
    const missing = await f.cli(['resume']); assert.notEqual(missing.code, 0); assert.match(missing.stderr, /A run exists only after aegean prepare --request FILE/);
  } finally { await f.cleanup(); }
});

async function configureTask(f: Awaited<ReturnType<typeof fixture>>, paths: string[]) {
  const file = join(f.repo, 'aegean.json'); const project = JSON.parse(await readFile(file, 'utf8'));
  project.modelExecution.task = { class: 'routine-cli', paths, dependencies: [], concerns: [] };
  await writeFile(file, JSON.stringify(project)); await f.realGit(['add', '.']); await f.realGit(['commit', '-m', 'explicit task context']); await f.realGit(['push', 'origin', 'main']);
}

test('completed Builder replay survives changed task context after its candidate commit', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    await configureTask(f, ['app.cjs']);
    ok(await f.start()); ok(await decision(f, 'approve'));
    await f.scenario({ builderCheckpointAfter: true });
    assert.notEqual((await f.resume()).code, 0); assert.equal((await f.current()).state, 'building');
    await f.scenario({}); ok(await f.resume());
    assert.equal((await f.current()).state, 'human-merge-review');
    const builders = (await f.events()).filter(e => e.role === 'builder'); assert.equal(builders.length, 1);
    assert.equal(builders[0]!.model, 'gpt-6.1-sol'); assert.equal(builders[0]!.effort, 'model_reasoning_effort="medium"');
  } finally { await f.cleanup(); }
});

test('required Scout context overflow persists a pause before any model call', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    await writeFile(join(f.repo, 'README.md'), 'x'.repeat(70_000)); await configureTask(f, ['app.cjs']);
    const started = await f.start(); assert.notEqual(started.code, 0);
    assert.equal((await f.current()).state, 'paused'); assert.match((await f.current()).reason!, /required context exceeds \d+ bytes/);
    assert.equal((await f.events()).filter(e => e.role).length, 0);
  } finally { await f.cleanup(); }
});

test('required Builder contract overflow persists a pause before Builder launch', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    ok(await f.start()); const local = await f.local(); const id = (await f.current()).id;
    await writeFile(join(local.worktree, 'openspec/changes', id, 'design.md'), 'x'.repeat(70_000));
    ok(await f.resume()); ok(await decision(f, 'approve'));
    assert.notEqual((await f.resume()).code, 0); assert.equal((await f.current()).state, 'paused');
    assert.match((await f.current()).reason!, /required Builder context design.md exceeds 60000 bytes/);
    assert.equal((await f.events()).filter(e => e.role === 'builder').length, 0);
  } finally { await f.cleanup(); }
});

test('cumulative bridge output aborts Builder without importing a partial candidate', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    ok(await f.start()); ok(await decision(f, 'approve'));
    await f.scenario({ builderRepeatedOutput: true }); assert.notEqual((await f.resume()).code, 0);
    assert.equal((await f.current()).state, 'paused');
    assert.equal((await f.events()).filter(e => e.role === 'builder').length, 1);
    assert.ok((await f.events()).filter(e => e.effect === 'tool-output-call').length <= 4);
    assert.match(await readFile(join((await f.local()).worktree, 'app.cjs'), 'utf8'), /broken/);
    assert.deepEqual((await f.ledger()).repositories, {});
  } finally { await f.cleanup(); }
});

test('required credential paths cannot enter Scout context', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    await writeFile(join(f.repo, '.env'), 'SYNTHETIC_SECRET=fixture-only'); await configureTask(f, ['.env']);
    const started = await f.start(); assert.notEqual(started.code, 0);
    assert.equal((await f.current()).state, 'paused'); assert.match((await f.current()).reason!, /protected.*context/);
    assert.equal((await f.events()).filter(e => e.role).length, 0);
  } finally { await f.cleanup(); }
});

test('a qualified smaller Builder escalates within the same protected suite and charged budget', async () => {
  const f = await fixture({ approvalMode: 'local', qualifiedBuilder: true });
  try {
    await configureTask(f, ['app.cjs']); ok(await f.start()); ok(await decision(f, 'approve'));
    await f.scenario({ verifierFailOnce: true }); ok(await f.resume());
    const run = await f.current(); assert.equal(run.state, 'human-merge-review'); assert.equal(run.repairs, 1);
    const events = await f.events();
    assert.deepEqual(events.filter(e => e.role === 'builder').map(e => e.model), ['gpt-6-luna', 'gpt-6.1-sol']);
    assert.equal(events.filter(e => e.role === 'auditor-tests').length, 1);
    assert.ok(events.filter(e => String(e.role).startsWith('auditor')).every(e => e.model === 'claude-sonnet-5'));
    const status = await f.cli(['status', '--run', run.id]); ok(status);
    const usage = JSON.parse(status.stdout).usage;
    assert.equal(usage.calls, 6); assert.equal(usage.tokens.consumed, 90); assert.equal(usage.tokens.reserved, 0);
  } finally { await f.cleanup(); }
});
