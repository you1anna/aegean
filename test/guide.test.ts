import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guide, type Guide } from '../src/application/guide.js';
import { GuideStop, runChoices, checkFix, LIMIT_FIELDS, REQUEST_TEMPLATE, type Choice, type GuideUi } from '../src/domain/guide.js';
import { terminalUi, completePath, openEditor, openPager, wrap } from '../src/adapters/terminal.js';
import { brandLines, colourDepth, MARK_WIDTH, WORDMARK } from '../src/adapters/brand.js';
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
    async page(title, text) { lines.push(`PAGE ${title}`, text); },
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
  assert.deepEqual(checkFix('pilot-prerequisites')?.command, ['qualify']); assert.equal(checkFix('pilot-prerequisites')?.terminal, false);
  for (const name of ['subscription-overflow', 'host-exclusions', 'release-acceptance']) assert.equal(checkFix(name), undefined, name);
  for (const fix of ['claude-subscription', 'codex-subscription', 'verifier-vm', 'pilot-prerequisites']) assert.equal(validateArguments(checkFix(fix)!.command), undefined);
  // An incomplete draft shows its flags on the approval choice; a complete draft does not.
  const approve = (flags?: string) => runChoices('spec-drafted', { ...facts, ...(flags ? { flags } : {}) }).find(choice => choice.value === 'approve')!.hint;
  assert.equal(approve('2 open questions'), '2 open questions; you type the confirmation; aegean approve'); assert.equal(approve(), 'you type the confirmation; aegean approve');
});

test('the guide runs the documented command sequence to specification approval, then stops', async () => {
  let state: State = 'requested', pilot = false;
  const h = await harness([
    'new', 'yes', 'file', '/tmp/request.md',
    'authorise', 'enter', '', '6', '', '', '',
    'draft', 'approve', 'no', 'approve', 'yes', choices => choices[0]!.value,
  ], args => {
    switch (args[0]) {
      case 'doctor': return readiness();
      case 'project': return projectCheck;
      case 'prepare': return { id, state: 'requested', reused: false };
      case 'authorize-pilot': pilot = true; return { authorized: true };
      case 'resume': state = 'spec-drafted'; return { run: { id } };
      case 'approve': state = 'spec-approved'; return { authorized: true };
      case 'status': return args.length === 1 ? { runs: [{ id: 'run-other', host, state: 'spec-drafted' }, { id: 'run-foreign', host: 'another', state: 'building' }, { id: 'run-old', host, state: 'cancelled' }] }
        : { id, state, ...(pilot ? { pilot: { expiresAt: new Date(2_000_000).toISOString() } } : {}), ...(state === 'requested' ? {} : { specification: '/state/spec/', spec: 'a'.repeat(64) }),
          ...(state === 'spec-drafted' ? { review: { projectRulesThatLimitedTheRequest: ['AGENTS.md: no code'], openQuestions: ['Which format?'], notCovered: ['Queue: NOT COVERED'] } } : {}), next: [] };
      default: return new Error(`unexpected command ${args.join(' ')}`);
    }
  });
  try {
    const limits = join(h.state, 'pilot-limits.json');
    assert.deepEqual(h.commands(), ['doctor', 'status', 'project check', 'prepare --request /tmp/request.md', `status --run ${id}`,
      `authorize-pilot --run ${id} --limits ${limits}`, `status --run ${id}`, `resume --run ${id}`, `status --run ${id}`, `status --run ${id}`, `approve --run ${id}`, `status --run ${id}`]);
    assert.deepEqual(h.outcome, { run: id, interrupted: false }); assert.deepEqual(h.unused, []);
    // The entered limits pass the owner schema and stay private.
    const saved = PilotLimitsSchema.parse(JSON.parse(await readFile(limits, 'utf8')));
    assert.equal(saved.maxModelCalls, 6); assert.equal(saved.expiresInMinutes, LIMIT_FIELDS[0].initial); assert.equal((await stat(limits)).mode & 0o077, 0);
    const text = h.text();
    for (const expected of ['$ aegean prepare --request /tmp/request.md', '1 unfinished run(s) belong to another host', 'README.md  10 bytes', 'AGENTS.md: no code', 'Which format?', 'Type the confirmation yourself', `aegean status --run ${id}`]) assert.ok(text.includes(expected), expected);
    assert.ok(!text.includes('$ aegean status --run'), 'status polls are not echoed');
    // The first answer to an incomplete draft goes back and runs no approval. The lists appear once; the flags appear each time.
    assert.equal(h.questions.filter(question => question === 'Do you want to approve the draft as it is?').length, 2);
    assert.equal(text.split('The draft is not complete: 1 open question, 1 request need not covered. An approval accepts').length, 3);
    assert.equal(text.split('Open questions that you must answer:').length, 2); assert.equal(text.split('The draft is not complete: 1 open question, 1 request need not covered. Correct').length, 3);
    assert.match(text, /The pilot authorisation ends in 16 minutes, at \d\d:\d\d\. You cannot extend it\./); assert.ok(!text.includes('you can only cancel this run'));
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
    assert.match(h.text(), /expired\. It cannot be replaced/); assert.ok(!h.text().includes('The pilot authorisation ends in'));
  } finally { await h.cleanup(); }
});

test('the specification review warns before the authorisation ends and keeps each file open until the operator closes it', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'aegean-spec-')));
  await writeFile(join(folder, 'review-notes.md'), '# Review notes\n'); await writeFile(join(folder, 'proposal.md'), 'Synthetic proposal\n');
  const drafted = { id, state: 'spec-drafted', spec: 'a'.repeat(64), pilot: { expiresAt: new Date(1000 + 9 * 60_000 + 59_000).toISOString() }, specification: folder, next: [] };
  const files: (string | undefined)[] = [];
  const pick = (value: string) => (choices: Choice<string>[]) => { files.push(choices.map(choice => `${choice.value}${choice.hint ? `:${choice.hint}` : ''}`).join(' ')); return value; };
  const h = await harness([id, 'read', pick('review-notes.md'), pick('proposal.md'), pick('design.md'), pick(''), 'stop'],
    args => args[0] === 'doctor' ? readiness() : args.length === 1 ? { runs: [{ id, host, state: 'spec-drafted' }] } : args[0] === 'status' ? drafted : new Error('unexpected'), { now: 1000 });
  try {
    assert.match(h.text(), /The pilot authorisation ends in 9 minutes, at \d\d:\d\d\. You cannot extend it\. After that time you can only cancel this run\./);
    assert.deepEqual(h.lines.filter(line => line.startsWith('PAGE ')), ['PAGE review-notes.md', 'PAGE proposal.md']); assert.ok(h.lines.includes('Synthetic proposal\n'));
    assert.match(h.text(), /FAILED Cannot read design\.md/);
    // The allowed paths are part of the approval, so the guide offers them with the requirements.
    assert.match(files[0]!, /specs\/contract\/spec\.md allowed-paths\.txt design\.md/);
    // A file that was read is marked. One status poll serves all the files; the menu returns only after "Go back".
    assert.match(files[1]!, /^review-notes\.md:read proposal\.md /); assert.match(files[3]!, /^review-notes\.md:read proposal\.md:read specs/);
    assert.deepEqual(h.commands(), ['doctor', 'status', `status --run ${id}`, `status --run ${id}`]);
    // A complete draft has no flag and no second question before the approval.
    assert.ok(!h.text().includes('The draft is not complete'));
  } finally { await h.cleanup(); await rm(folder, { recursive: true, force: true }); }
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

function terminal(pager: (text: string) => Promise<boolean> = async () => false) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60 });
  let written = ''; output.on('data', chunk => { written += chunk; });
  const keys = (text: string) => setImmediate(() => input.write(text));
  return { ui: terminalUi(input, output, pager), keys, screen: () => stripVTControlCharacters(written) };
}

test('long text breaks at spaces with the list indent; a pager shows a file, and without one the file waits for an answer', async () => {
  assert.equal(wrap('  - one two three four', 12), '  - one two\n    three\n    four'); assert.equal(wrap('short\n\n1. a b', 80), 'short\n\n1. a b');
  assert.equal(wrap('/a/very/long/path/that/has/no/space next', 10), '/a/very/long/path/that/has/no/space\nnext'); assert.equal(wrap(`${' '.repeat(8)}a b c`, 10), `${' '.repeat(8)}a b c`); assert.equal(wrap('$ aegean status --run ID', 10), '$ aegean status --run ID');
  const long = `- ${'word '.repeat(30).trim()}`;
  const t = terminal(); t.ui.warn(long); t.ui.say(long);
  for (const line of t.screen().split('\n')) assert.ok(line.length <= 59, line);
  assert.match(t.screen(), /! - word[^\n]*\n {4}word/); assert.match(t.screen(), /\n- word[^\n]*\n {2}word/);
  // The fallback prints the file and then waits. The menu of the guide cannot replace the text before the answer.
  let answered = false; t.keys('\r');
  await t.ui.page('proposal.md', long).then(() => { answered = true; });
  assert.ok(answered); assert.match(t.screen(), /proposal\.md\n\n- word[\s\S]*End of proposal\.md/);
  let paged = ''; const p = terminal(async text => { paged = text; return true; });
  await p.ui.page('design.md', long);
  assert.match(paged, /^design\.md {2}\(Space: next page, q: close\)\n\n- word/); for (const line of paged.split('\n')) assert.ok(line.length <= 59, line);
  assert.match(p.screen(), /✔ Read design\.md/); assert.ok(!p.screen().includes('- word'));
  assert.equal(await openPager('text', { PAGER: '/bin/cat >/dev/null' }), true); assert.equal(await openPager('text', { PAGER: 'exit 3' }), false);
  assert.equal(await openPager('x'.repeat(500_000), { PAGER: '/usr/bin/true' }), true);
  p.keys('\r'); assert.equal(await p.ui.select('Which?', [{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }], 'b'), 'b');
});

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

test('the banner shows the mark in the colours that the terminal supports and fits the width', () => {
  const stream = (depth?: number) => Object.assign(new PassThrough(), { isTTY: true, ...(depth ? { getColorDepth: () => depth } : {}) });
  const plain = brandLines(59, stream(1));
  assert.equal(colourDepth(stream(1)), 1); assert.equal(colourDepth(stream(24)), 24);
  assert.equal(plain.join('\n'), stripVTControlCharacters(plain.join('\n')), 'no escape code without colour');
  assert.ok(plain.length > 5); assert.equal(plain.at(-1)!.trim(), WORDMARK); for (const line of plain) assert.ok(line.length <= 59, line);
  const full = brandLines(59, stream(24)).join('\n');
  assert.match(full, /\x1b\[38;2;240;140;72m/); assert.equal(stripVTControlCharacters(full), plain.join('\n'));
  assert.match(brandLines(59, stream(8)).join('\n'), /\x1b\[38;5;\d+m/);
  // Below the width of the mark, only the wordmark shows. The narrowest terminal gets the short name.
  assert.deepEqual(brandLines(MARK_WIDTH, stream(1)), [`  ${WORDMARK}`]); assert.deepEqual(brandLines(20, stream(1)), ['AEGEAN']);
  const t = terminal(); t.ui.banner('Aegean guide', ['One line.']); t.ui.step('Host'); t.ui.step('x'.repeat(80));
  assert.match(t.screen(), /Λ {3}E {3}G[\s\S]*Aegean guide\nOne line\.\n\nHost ─+\n/);
  for (const line of t.screen().split('\n')) assert.ok(line.length <= 59, line);
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
    const first = scripted(['yes', 'file', join(f.dir, 'request.md'), 'draft', 'read', 'review-notes.md', '', 'stop']);
    const outcome = await guide({ ui: first.ui, execute, edit: async () => false, state: f.state, signal: new AbortController().signal, now: Date.now });
    const run = await f.current();
    assert.equal(run.state, 'spec-drafted'); assert.deepEqual(outcome, { run: run.id, interrupted: false });
    assert.equal((await f.events()).filter(event => event.role).length, 1);
    assert.match(first.text(), /fixture\/project at revision [a-f0-9]{12}/); assert.match(first.text(), /aegean\.json|app\.cjs/);
    assert.match(first.text(), /Synthetic open question/); assert.match(first.text(), /# Review notes/);
    // A second session finds the unfinished run, makes no model call and leaves the approval to the terminal prompt.
    const second = scripted([run.id, choices => { assert.deepEqual(values(choices), ['read', 'edit', 'record', 'approve', 'stop', 'cancel']); return 'approve'; }, 'yes', 'stop']);
    await guide({ ui: second.ui, execute, edit: async () => false, state: f.state, signal: new AbortController().signal, now: Date.now });
    // The status command reads the flags from the notes file; a new session shows them without a model call.
    assert.match(second.text(), /Synthetic open question/); assert.match(second.text(), /The draft is not complete: 1 open question\./);
    assert.match(second.text(), /FAILED Human decision requires the operator at an interactive terminal/);
    assert.equal((await f.current()).state, 'spec-drafted'); assert.equal((await f.events()).filter(event => event.role).length, 1);
  } finally { await f.cleanup(); }
});
