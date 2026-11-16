import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guide, type Guide } from '../src/application/guide.js';
import { GuideStop, runChoices, checkFix, LIMIT_FIELDS, REQUEST_TEMPLATE, type Choice, type GuideUi } from '../src/domain/guide.js';
import { terminalUi, completePath, openEditor } from '../src/adapters/terminal.js';
import { validateArguments } from '../src/application/cli-arguments.js';
import { PilotLimitsSchema } from '../src/domain/pilot-limits.js';
import type { State } from '../src/domain/workflow.js';
import { fixture } from './helpers/coordinator.js';

const id = 'run-00000000-0000-4000-8000-000000000000';
const host = '11111111-1111-4111-8111-111111111111';
const facts = { pilot: false, pilotExpired: false, acceptedRelease: false, specification: true };
const values = (choices: Choice<string>[]) => choices.map(choice => choice.value);

/** Answers each question in order. A selection that the guide does not offer fails the test. */
function scripted(answers: (string | ((choices: Choice<string>[]) => string))[]) {
  const lines: string[] = [], questions: string[] = [];
  const next = (question: string) => { questions.push(question); if (!answers.length) throw new Error(`no scripted answer for: ${question}`); return answers.shift()!; };
  const ui: GuideUi = {
    banner: (title, body) => { lines.push(title, ...body); }, step: text => { lines.push(text); }, say: text => { lines.push(text); }, note: text => { lines.push(text); },
    good: text => { lines.push(text); }, warn: text => { lines.push(text); }, bad: text => { lines.push(`FAILED ${text}`); },
    async select(question, choices) {
      const answer = next(question); const value = typeof answer === 'function' ? answer(choices) : answer;
      assert.ok(values(choices).includes(value), `"${value}" is not offered for "${question}": ${values(choices).join(', ')}`);
      return value as never;
    },
    async text(question, options) { const value = next(question) as string || options?.initial || ''; assert.equal(options?.validate?.(value), undefined, question); return value; },
    task: (_label, work) => work(),
  };
  return { ui, lines, questions, text: () => lines.join('\n'), unused: answers };
}
const readiness = (overrides: Record<string, unknown> = {}) => ({ host, prerequisitesReady: true, fullWorkflowReady: false, operations: '/release/docs/OPERATIONS.md',
  checks: [{ name: 'node', ok: true, detail: 'v1' }, { name: 'host-config', ok: true, detail: 'configured' }, { name: 'release-acceptance', ok: false, detail: 'bootstrap' }], ...overrides });
const projectCheck = { base: 'a'.repeat(40), project: { repository: 'fixture/project' }, agentContext: { files: [{ path: 'README.md', bytes: 10, required: true }], omitted: [], bytes: 10, limitBytes: 100 } };

async function harness(answers: Parameters<typeof scripted>[0], respond: (args: string[], calls: string[][]) => unknown, options: { signal?: AbortSignal; now?: number; edit?: Guide['edit'] } = {}) {
  const state = await realpath(await mkdtemp(join(tmpdir(), 'aegean-guide-')));
  const script = scripted(answers); const calls: string[][] = [];
  const execute = async (args: string[]) => { assert.equal(validateArguments(args), undefined); calls.push(args); const value = respond(args, calls); if (value instanceof Error) throw value; return value; };
  const outcome = await guide({ ui: script.ui, execute, edit: options.edit ?? (async () => false), state, signal: options.signal ?? new AbortController().signal, now: () => options.now ?? 1_000_000 });
  return { ...script, calls, outcome, state, commands: () => calls.map(call => call.join(' ')), cleanup: () => rm(state, { recursive: true, force: true }) };
}

test('each live run state offers only its commands; later states and ended runs have no menu', () => {
  assert.deepEqual(values(runChoices('requested', facts)), ['authorise', 'stop', 'cancel']);
  assert.deepEqual(values(runChoices('requested', { ...facts, pilot: true })), ['draft', 'stop', 'cancel']);
  assert.deepEqual(values(runChoices('requested', { ...facts, acceptedRelease: true })), ['draft', 'stop', 'cancel']);
  assert.deepEqual(values(runChoices('spec-drafted', facts)), ['read', 'edit', 'record', 'approve', 'stop', 'cancel']);
  // A run of another host has no local folder to read or edit.
  assert.deepEqual(values(runChoices('spec-drafted', { ...facts, specification: false })), ['record', 'approve', 'stop', 'cancel']);
  assert.deepEqual(values(runChoices('paused', facts)), ['continue', 'stop', 'cancel']);
  // After approval the first choice stops: the build stage is outside the guide.
  for (const state of ['spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair'] as const) assert.deepEqual(values(runChoices(state, facts)), ['stop', 'continue', 'cancel']);
  for (const state of ['human-merge-review', 'merged', 'archived', 'cancelled', 'escalated'] as const) assert.deepEqual(runChoices(state, facts), []);
  // An expired authorisation cannot be replaced; no choice may lead to a command that fails.
  for (const state of ['requested', 'spec-drafted', 'paused', 'building'] as State[]) assert.deepEqual(values(runChoices(state, { ...facts, pilot: true, pilotExpired: true })), ['cancel', 'stop']);
  assert.deepEqual(checkFix('claude-subscription')?.command, ['auth', 'login', 'claude']); assert.equal(checkFix('verifier-vm')?.terminal, false);
  for (const name of ['subscription-overflow', 'pilot-prerequisites', 'host-exclusions', 'release-acceptance']) assert.equal(checkFix(name), undefined, name);
  for (const fix of ['claude-subscription', 'codex-subscription', 'verifier-vm']) assert.equal(validateArguments(checkFix(fix)!.command), undefined);
});

test('the guide runs the documented command sequence to specification approval, then stops', async () => {
  let state: State = 'requested', pilot = false;
  const h = await harness([
    'new', 'yes', 'file', '/tmp/request.md',
    'authorise', 'enter', '', '6', '', '', '',
    'draft', 'approve', choices => choices[0]!.value,
  ], args => {
    switch (args[0]) {
      case 'doctor': return readiness();
      case 'project': return projectCheck;
      case 'prepare': return { id, state: 'requested', reused: false };
      case 'authorize-pilot': pilot = true; return { authorized: true };
      case 'resume': state = 'spec-drafted'; return { run: { id }, review: { projectRulesThatLimitedTheRequest: ['AGENTS.md: no code'], openQuestions: ['Which format?'], notCovered: [] } };
      case 'approve': state = 'spec-approved'; return { authorized: true };
      case 'status': return args.length === 1 ? { runs: [{ id: 'run-other', host, state: 'spec-drafted' }, { id: 'run-foreign', host: 'another', state: 'building' }, { id: 'run-old', host, state: 'cancelled' }] }
        : { id, state, ...(pilot ? { pilot: { expiresAt: new Date(2_000_000).toISOString() } } : {}), ...(state === 'requested' ? {} : { specification: '/state/spec/' }), next: [] };
      default: return new Error(`unexpected command ${args.join(' ')}`);
    }
  });
  try {
    const limits = join(h.state, 'pilot-limits.json');
    assert.deepEqual(h.commands(), ['doctor', 'status', 'project check', 'prepare --request /tmp/request.md', `status --run ${id}`,
      `authorize-pilot --run ${id} --limits ${limits}`, `status --run ${id}`, `resume --run ${id}`, `status --run ${id}`, `approve --run ${id}`, `status --run ${id}`]);
    assert.deepEqual(h.outcome, { run: id, interrupted: false }); assert.deepEqual(h.unused, []);
    // The entered limits pass the owner schema and stay private.
    const saved = PilotLimitsSchema.parse(JSON.parse(await readFile(limits, 'utf8')));
    assert.equal(saved.maxModelCalls, 6); assert.equal(saved.expiresInMinutes, LIMIT_FIELDS[0].initial); assert.equal((await stat(limits)).mode & 0o077, 0);
    const text = h.text();
    for (const expected of ['$ aegean prepare --request /tmp/request.md', '1 unfinished run(s) belong to another host', 'README.md  10 bytes', 'AGENTS.md: no code', 'Which format?', 'Type the confirmation yourself', `aegean status --run ${id}`]) assert.ok(text.includes(expected), expected);
    assert.ok(!text.includes('$ aegean status --run'), 'status polls are not echoed');
  } finally { await h.cleanup(); }
});

test('a failed command shows its recovery hint and causes no later effect', async () => {
  const h = await harness(['yes', 'file', '/tmp/request.md', 'stop'], args => args[0] === 'doctor' ? readiness() : args[0] === 'status' ? { runs: [] } : args[0] === 'project' ? projectCheck
    : new Error('commit or preserve current work before starting an isolated run'));
  try {
    assert.deepEqual(h.commands(), ['doctor', 'status', 'project check', 'prepare --request /tmp/request.md']);
    assert.match(h.text(), /FAILED commit or preserve current work/); assert.match(h.text(), /Commit the project changes, push main to origin/);
    assert.deepEqual(h.outcome, { interrupted: false });
  } finally { await h.cleanup(); }
});

test('failed host checks offer only the commands that correct them; no configuration means no continue', async () => {
  let checked = 0;
  const failing = [{ name: 'claude-subscription', ok: false, detail: 'not verified' }, { name: 'subscription-overflow', ok: false, detail: 'operator must confirm' }, { name: 'host-config', ok: false, detail: 'run aegean configure' }];
  const h = await harness([choices => { assert.deepEqual(values(choices), ['fix-0', 'again', 'stop']); return 'fix-0'; }, 'stop'],
    args => args[0] === 'doctor' ? (checked++, readiness({ prerequisitesReady: false, checks: failing })) : args[0] === 'auth' ? { claude: true } : new Error('unexpected'));
  try {
    assert.deepEqual(h.commands(), ['doctor', 'auth login claude', 'doctor']); assert.equal(checked, 2);
    assert.match(h.text(), /2 host checks failed|3 host checks failed/); assert.match(h.text(), /\/release\/docs\/OPERATIONS\.md/);
  } finally { await h.cleanup(); }
});

test('cancellation needs a second answer, and an expired pilot offers no resume', async () => {
  const expired = { id, state: 'spec-drafted', pilot: { expiresAt: new Date(500).toISOString() }, specification: '/state/spec/', next: ['The pilot authorisation expired. It cannot be replaced.'] };
  const h = await harness([id, choices => { assert.deepEqual(values(choices), ['cancel', 'stop']); return 'cancel'; }, 'no', 'stop'],
    args => args[0] === 'doctor' ? readiness() : args.length === 1 ? { runs: [{ id, host, state: 'spec-drafted' }] } : args[0] === 'status' ? expired : new Error('unexpected'), { now: 1000 });
  try {
    assert.ok(!h.commands().some(command => /^(cancel|resume|approve|authorize-pilot)/.test(command)), h.commands().join('; '));
    assert.match(h.text(), /expired\. It cannot be replaced/);
  } finally { await h.cleanup(); }
});

test('an interrupted command stops the guide with the interruption result', async () => {
  const controller = new AbortController();
  const h = await harness([id, 'record'], args => {
    if (args[0] === 'doctor') return readiness({ fullWorkflowReady: true });
    if (args[0] === 'resume') { controller.abort(); return new Error('interrupted before external effect'); }
    return args.length === 1 ? { runs: [{ id, host, state: 'spec-drafted' }] } : { id, state: 'spec-drafted', next: [] };
  }, { signal: controller.signal });
  try { assert.deepEqual(h.outcome, { run: id, interrupted: true }); assert.equal(h.commands().at(-1), `resume --run ${id}`); assert.match(h.text(), /keeps its state/); }
  finally { await h.cleanup(); }
});

test('a written request stays private; an unchanged template prepares nothing', async () => {
  const respond = (args: string[]) => args[0] === 'doctor' ? readiness() : args[0] === 'status' ? { runs: [] } : args[0] === 'project' ? projectCheck : args[0] === 'prepare' ? { id, reused: true } : new Error('unexpected');
  const empty = await harness(['yes', 'write', 'stop'], respond, { edit: async () => true });
  try { assert.ok(!empty.commands().some(command => command.startsWith('prepare'))); assert.match(empty.text(), /The request has no text/); } finally { await empty.cleanup(); }
  let edited = '';
  const written = await harness(['yes', 'write', 'stop'], (args, calls) => args[0] === 'status' && args.length > 1 ? { id, state: 'requested', next: [] } : respond(calls.at(-1)!),
    { edit: async path => { edited = path; assert.equal(await readFile(path, 'utf8'), REQUEST_TEMPLATE); await writeFile(path, '# Goal\nPrint ok.\n'); return true; } });
  try {
    assert.equal(edited, join(written.state, 'requests', (await readdir(join(written.state, 'requests')))[0]!));
    assert.equal((await stat(edited)).mode & 0o077, 0); assert.equal((await stat(join(written.state, 'requests'))).mode & 0o077, 0);
    assert.ok(written.commands().includes(`prepare --request ${edited}`)); assert.match(written.text(), /is the existing run for this request/);
  } finally { await written.cleanup(); }
});

function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60 });
  let written = ''; output.on('data', chunk => { written += chunk; });
  const keys = (text: string) => setImmediate(() => input.write(text));
  return { ui: terminalUi(input, output), keys, screen: () => stripVTControlCharacters(written) };
}

test('the terminal selects with arrow keys or a number, applies defaults and stops on Ctrl-C', async () => {
  const choices = [{ value: 'a', label: 'First' }, { value: 'b', label: 'Second', hint: 'a hint' }, { value: 'c', label: 'Third' }];
  const t = terminal();
  t.keys('\x1b[B\r'); assert.equal(await t.ui.select('Which?', choices), 'b');
  t.keys('\x1b[A\r'); assert.equal(await t.ui.select('Which?', choices), 'c');
  t.keys('3'); t.keys('9'); t.keys('\r'); assert.equal(await t.ui.select('Which?', choices), 'c');
  assert.match(t.screen(), /2\. Second {2}\(a hint\)/); assert.match(t.screen(), /✔ Which\? Second/);
  t.keys('\r'); assert.equal(await t.ui.text('Calls', { initial: '12' }), '12');
  t.keys('x\r'); t.keys('7\r'); assert.equal(await t.ui.text('Calls', { validate: value => /^\d+$/.test(value) ? undefined : 'Give a whole number.' }), '7');
  assert.match(t.screen(), /Give a whole number\./);
  t.keys('\x03'); await assert.rejects(t.ui.select('Which?', choices), (error: unknown) => error instanceof GuideStop && error.interrupted);
  t.keys('\x03'); await assert.rejects(t.ui.text('Path'), (error: unknown) => error instanceof GuideStop && error.interrupted);
  assert.equal(await t.ui.task('Work', async () => 5), 5); await assert.rejects(t.ui.task('Work', async () => { throw new Error('failed'); }), /failed/);
  assert.match(t.screen(), /✔ Work/); assert.match(t.screen(), /✖ Work/);
});

test('the terminal has no unattended mode and completes paths only from real folders', async () => {
  assert.throws(() => terminalUi(new PassThrough(), Object.assign(new PassThrough(), { isTTY: true })), /interactive terminal/);
  assert.throws(() => terminalUi(Object.assign(new PassThrough(), { isTTY: true }), new PassThrough()), /interactive terminal/);
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'aegean-complete-')));
  try {
    await writeFile(join(dir, 'request.md'), 'x'); await writeFile(join(dir, 'other.md'), 'x');
    assert.deepEqual(completePath(`${dir}/req`), [[`${dir}/request.md`], `${dir}/req`]);
    assert.deepEqual(completePath(`${dir}/`)[0].sort(), [`${dir}/other.md`, `${dir}/request.md`]);
    assert.deepEqual(completePath(`${dir}/absent/x`), [[], `${dir}/absent/x`]);
    assert.equal(await openEditor(join(dir, 'request.md'), {}), false);
    assert.equal(await openEditor(join(dir, 'request.md'), { EDITOR: '/usr/bin/true' }), true);
    await assert.rejects(openEditor(join(dir, 'request.md'), { VISUAL: '/usr/bin/false', EDITOR: '/usr/bin/true' }), /editor stopped/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the guide drives the real commands to a drafted specification; the command itself refuses a pipe', async () => {
  const f = await fixture({ approvalMode: 'local' });
  try {
    const refused = await f.cli(['guide']); assert.equal(refused.code, 1); assert.match(refused.stderr, /interactive terminal/);
    const bare = await f.cli([]); assert.equal(bare.code, 0); assert.match(bare.stdout, /aegean guide/); assert.match(bare.stdout, /prepare --request FILE/);
    assert.deepEqual((await f.ledger()).runs, {});
    const execute = async (args: string[]) => {
      const result = await f.cli(args);
      if (result.code !== 0) throw new Error(JSON.parse(result.stderr.trim().split('\n').at(-1)!).error);
      return JSON.parse(result.stdout);
    };
    const first = scripted(['yes', 'file', join(f.dir, 'request.md'), 'draft', 'read', 'review-notes.md', 'stop']);
    const outcome = await guide({ ui: first.ui, execute, edit: async () => false, state: f.state, signal: new AbortController().signal, now: Date.now });
    const run = await f.current();
    assert.equal(run.state, 'spec-drafted'); assert.deepEqual(outcome, { run: run.id, interrupted: false });
    assert.equal((await f.events()).filter(event => event.role).length, 1);
    assert.match(first.text(), /fixture\/project at revision [a-f0-9]{12}/); assert.match(first.text(), /aegean\.json|app\.cjs/);
    assert.match(first.text(), /Synthetic open question/); assert.match(first.text(), /# Review notes/);
    // A second session finds the unfinished run, makes no model call and leaves the approval to the terminal prompt.
    const second = scripted([run.id, choices => { assert.deepEqual(values(choices), ['read', 'edit', 'record', 'approve', 'stop', 'cancel']); return 'approve'; }, 'stop']);
    await guide({ ui: second.ui, execute, edit: async () => false, state: f.state, signal: new AbortController().signal, now: Date.now });
    assert.match(second.text(), /FAILED Human decision requires the operator at an interactive terminal/);
    assert.equal((await f.current()).state, 'spec-drafted'); assert.equal((await f.events()).filter(event => event.role).length, 1);
  } finally { await f.cleanup(); }
});
