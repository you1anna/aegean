import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { command } from '../src/adapters/process.js';
import { outputMode, toPlain, toJson, clean, label, splitCommand, parseResultText, renderResult, renderError, errorPayload, type View, type Paint } from '../src/application/cli-output.js';
import { validateArguments, commandHelp } from '../src/application/cli-arguments.js';
import { checkLevel } from '../src/domain/guide.js';

const plain: View = { width: 100, paint: (_style, text) => text };
const wide: View = { width: 400, paint: (_style, text) => text };
const marked: View = { width: 100, paint: ((style, text) => `<${style}>${text}</${style}>`) as Paint };
const id = 'run-00000000-0000-4000-8000-000000000000';
const host = '11111111-1111-4111-8111-111111111111';
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const leaves = (value: unknown): string[] => value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : typeof value === 'string' ? [value] : [];
const doctor = { version: '0.1.0', host, capability: 'bounded-cli-v1', prerequisitesReady: false, crossHostHandoff: false, fullWorkflowReady: false,
  checks: [{ name: 'node', ok: true, detail: 'v26.12.1' }, { name: 'claude', ok: false, detail: 'not installed in this release' }, { name: 'release-acceptance', ok: false, detail: 'no acceptance record' }],
  operations: '/opt/aegean/docs/OPERATIONS.md' };
const listing = { owners: { [id]: { run: id, host, generation: 3 } }, repositories: {}, builder: null,
  runs: [{ id, host, state: 'cancelled', repairs: 0, activeMs: 95487 }, { id: id.replace('0000-4000', '0000-4001'), host, state: 'requested', repairs: 1, activeMs: 0 }],
  next: ['Inspect a run and its next step: aegean status --run ID'] };

test('the output is JSON unless an operator at a terminal omits --json', () => {
  assert.equal(outputMode(['status'], true), 'text');
  assert.equal(outputMode(['status'], false), 'json');
  assert.equal(outputMode(['status', '--json'], true), 'json');
  assert.equal(outputMode(['doctor', '--json'], false), 'json');
});

test('JSON output is unchanged for JSON data and never throws after a command has effects', () => {
  for (const value of [doctor, listing, [], {}, 'text', 0, null, { nested: { list: [1, 'a', true, null] } }]) assert.equal(toJson(value), JSON.stringify(value, null, 2));
  assert.equal(toJson(undefined), undefined);
  const cycle: Record<string, unknown> = { name: 'loop', size: 10n }; cycle.self = cycle;
  assert.deepEqual(JSON.parse(toJson(cycle)!), { name: 'loop', size: '10', self: '[circular]' });
  const shared = { a: 1 };
  assert.deepEqual(toPlain({ left: shared, right: shared, list: [shared, shared] }), { left: { a: 1 }, right: { a: 1 }, list: [{ a: 1 }, { a: 1 }] }, 'a repeated reference is not a cycle');
  assert.deepEqual(toPlain({ when: new Date(0), nan: NaN, gone: undefined, fn: () => 1, list: [undefined, () => 1, Infinity] }), { when: '1970-01-01T00:00:00.000Z', nan: null, list: [null, null, null] });
  assert.equal(toPlain({ toJSON() { throw new Error('no'); } }), '[unserialisable]');
  const parsed = toPlain(JSON.parse('{"__proto__":{"polluted":true},"a":1}')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ['__proto__', 'a']); assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('terminal control sequences in results never reach the terminal', () => {
  assert.equal(clean('a\x1b[2Jb\x1b]0;title\x07c\x1b]8;;https://example.invalid\x1b\\link\x1b]8;;\x1b\\d'), 'abclinkd');
  assert.equal(clean('x\x9b2Jy\x00z\x7f‮evil⁦'), 'xyzevil');
  assert.equal(clean('one\r\ntwo\rthree\tfour'), 'one two three  four');
  assert.equal(clean('one\r\ntwo', true), 'one\ntwo');
  const hostile = { error: 'bad\x1b[31m\x1b]0;owned\x07', detail: 'line\x1b[2J\nnext\x1b[1A', checks: [{ name: 'x\x1b[K', ok: false, detail: '\x1b]52;c;Y29weQ==\x07' }], ['key\x1b[2J']: { note: '‮txt.exe' }, next: ['Run: aegean status\x1b[2J'] };
  for (const output of [renderResult(hostile, plain), renderResult(JSON.stringify(hostile), plain), renderError(errorPayload(new Error('x\x1b[2J\x07'), 'status'), plain)])
    assert.doesNotMatch(output.replaceAll('\n', ''), CONTROL);
});

test('field names read as words, while data keys and acronyms keep their form', () => {
  assert.equal(label('fullWorkflowReady'), 'Full workflow ready');
  assert.equal(label('id'), 'ID');
  assert.equal(label('prUrl'), 'PR URL');
  assert.equal(label('activeMs', 5), 'Active');
  assert.equal(label('activeMs', 'x'), 'Active ms');
  assert.equal(label('maxTokensPerRun'), 'Max tokens per run');
  assert.equal(label(id), id);
  assert.equal(label('kind:name'), 'kind:name');
});

test('a doctor report shows each check with its meaning and keeps each fact', () => {
  const text = renderResult(doctor, wide);
  for (const value of leaves(doctor)) assert.ok(text.includes(value), `missing ${value}`);
  assert.match(text, /^Prerequisites ready\s+no$/m);
  assert.match(text, /^ {2}✔ node: v26\.12\.1$/m);
  assert.match(text, /^ {2}✖ claude: not installed in this release$/m);
  assert.match(text, /^ {2}! release-acceptance: no acceptance record$/m);
  assert.deepEqual(doctor.checks.map(checkLevel), ['pass', 'fail', 'info']);
  assert.match(renderResult(doctor, marked), /Prerequisites ready {2}<red>no<\/red>/);
});

test('a run list is a table when it fits and numbered blocks when it does not; no value is cut', () => {
  const table = renderResult(listing, { ...plain, width: 160 });
  assert.match(table, /^ {2}ID {2,}Host {2,}State {2,}Repairs {2}Active$/m);
  assert.match(table, new RegExp(`^  ${id}  ${host}  cancelled  0 +1 min 35 s$`, 'm'));
  assert.match(table, /^Repositories\s+none$/m); assert.match(table, /^Builder\s+none$/m);
  const narrow = renderResult(listing, { ...plain, width: 60 });
  assert.match(narrow, new RegExp(`^  1\\. ID +${id}$`, 'm'));
  assert.match(narrow, /^ {5}State +requested$/m);
  for (const output of [table, narrow]) for (const value of leaves(listing).filter(value => !value.startsWith('Inspect'))) assert.ok(output.includes(value), `missing ${value}`);
  assert.match(renderResult(listing, marked), /<dim>cancelled<\/dim>/);
  assert.match(renderResult(listing, marked), /<bold>requested<\/bold>/);
});

test('next steps come last, with each command on its own unbroken line', () => {
  const long = `aegean authorize-pilot --run ${id} --limits FILE`;
  const text = renderResult({ state: 'spec-drafted', next: [
    `If aegean doctor reports that the full workflow is not ready, authorise a pilot first: ${long}`,
    `To approve in local approval mode: aegean approve --run ${id}, then aegean resume --run ${id}`,
    'Correct the cause of the pause: the verifier stopped',
  ] }, { ...plain, width: 40 });
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['State  spec-drafted', '', 'Next steps']);
  assert.ok(lines.includes(`     $ ${long}`), 'a long command is not wrapped');
  assert.deepEqual(lines.filter(line => line.includes('$ aegean')).map(line => line.trim()), [`$ ${long}`, `$ aegean approve --run ${id}`, `$ aegean resume --run ${id}`]);
  assert.deepEqual(lines.slice(-2), ['3. Correct the cause of the pause: the', '   verifier stopped'], 'text without a command wraps as prose');
  assert.deepEqual(splitCommand('Archive the specification: aegean resume --run X'), { prose: 'Archive the specification', commands: ['aegean resume --run X'] });
  assert.equal(splitCommand('Correct the cause of the pause: aegean, then something'), undefined);
  assert.equal(splitCommand('Read review notes in folder'), undefined);
});

test('an error or a block in a result comes first', () => {
  const lines = renderResult({ error: 'unknown run', next: ['List the runs: aegean status'] }, plain).split('\n');
  assert.equal(lines[0], '✖ unknown run');
  assert.deepEqual(lines.slice(-2), ['1. List the runs:', '     $ aegean status']);
  const blocked = renderResult({ run: { id, state: 'requested' }, blocked: 'Native containment must pass' }, plain).split('\n');
  assert.equal(blocked[0], '! Blocked: Native containment must pass');
  assert.match(renderResult({ error: { code: 7 } }, plain), /^Error\n {2}Code {2}7$/, 'an error that is not text stays in place');
  assert.equal(renderResult({ next: ['Archive: aegean resume --run X'] }, plain), 'Next steps\n1. Archive:\n     $ aegean resume --run X');
  assert.equal(renderResult({ state: 'archived', next: [] }, plain), 'State  archived');
});

test('values show as dates, durations, words and blocks without losing text', () => {
  const text = renderResult({ createdAt: 1794935335730, attempts: 1794935335730, limitAt: 12, durationMs: 950, activeTimeoutMs: 3_600_000, retryMs: 61_000,
    ok: true, empty: '', none: null, list: [], map: {}, notes: 'first line\nsecond line', tags: ['a', 'b'] }, plain);
  assert.match(text, /^Created at +2026-11-17 17:08:55 UTC$/m);
  assert.match(text, /^Attempts +1794935335730$/m);
  assert.match(text, /^Limit at +12$/m);
  assert.match(text, /^Duration +950 ms$/m);
  assert.match(text, /^Active timeout +1 h 0 min$/m);
  assert.match(text, /^Retry +1 min 1 s$/m);
  assert.match(text, /^Ok +yes$/m);
  assert.match(text, /^Empty +\(empty\)$/m);
  assert.match(text, /^None +none$/m); assert.match(text, /^List +none$/m); assert.match(text, /^Map +none$/m);
  assert.match(text, /^Notes\n {2}first line\n {2}second line$/m);
  assert.match(text, /^Tags\n {2}- a\n {2}- b$/m);
  assert.equal(renderResult({}, plain), 'No details.');
  assert.equal(renderResult(undefined, plain), '✔ Done');
  assert.equal(renderResult([], plain), 'none');
  assert.equal(renderResult(42, plain), '42');
  assert.equal(renderResult([[1, 2], { a: [] }], plain), '1. - 1\n   - 2\n2. A  none');
});

test('large and deep results stay bounded and say how to see all of the data', () => {
  const many = renderResult({ events: Array.from({ length: 205 }, (_, n) => ({ n, text: 'x'.repeat(300) })) }, plain);
  assert.match(many, /… 5 more; run the command with --json for the full list$/);
  let deep: unknown = 'bottom'; for (let n = 0; n < 30; n++) deep = { level: deep };
  assert.match(renderResult(deep, plain), /… nested too deeply; run the command with --json/);
  const long = renderResult({ detail: 'word '.repeat(60).trim(), path: '/'.concat('x'.repeat(150)) }, plain);
  assert.ok(long.split('\n').every(line => line.length <= 100 || line.includes('x'.repeat(150))), 'only an unbreakable value is wider than the terminal');
});

test('script output is parsed when it holds JSON and is shown unchanged otherwise', () => {
  assert.deepEqual(parseResultText('{"installed":"v1"}\n'), { lead: '', value: { installed: 'v1' } });
  assert.deepEqual(parseResultText('warning: one\nwarning: two\n{"installed":"v1"}\n'), { lead: 'warning: one\nwarning: two', value: { installed: 'v1' } });
  for (const text of ['plain text\n', '42', '"quoted"', 'null', '{broken', 'prefix {"a":1}', '', '\n\n']) assert.deepEqual(parseResultText(text), { lead: text });
  assert.equal(renderResult('warning: kept\n{"fullWorkflowReady":false}', plain), 'warning: kept\nFull workflow ready  no');
  assert.equal(renderResult('done\n', plain), 'done\n');
});

test('any thrown value gives an error message and recovery advice', () => {
  assert.deepEqual(errorPayload(new Error('invalid run identifier'), 'status'), { error: 'invalid run identifier', recovery: 'Copy the complete run identifier from aegean status.' });
  assert.equal(errorPayload('plain failure', 'status').error, 'plain failure');
  assert.equal(errorPayload({ code: 7 }, 'status').error, '{"code":7}');
  assert.equal(errorPayload(undefined, 'status').error, 'undefined');
  assert.equal(errorPayload(new Error(''), 'status').error, 'unknown failure');
  assert.equal(renderError({ error: 'first\nsecond', recovery: 'Do this.' }, plain), '✖ first\n  second\n  Do this.');
});

test('every command except the guide accepts --json once', () => {
  const usages = commandHelp().split('\n').filter(line => line.startsWith('  ')).map(line => line.trim().split(' ')[0]!);
  assert.ok(usages.length > 20);
  for (const name of usages.filter(name => name !== 'guide')) assert.equal(validateArguments([name, '--json']), undefined, name);
  assert.throws(() => validateArguments(['guide', '--json']), /unknown option --json/);
  assert.throws(() => validateArguments(['status', '--json', '--json']), /duplicate option: --json/);
  assert.throws(() => validateArguments(['status', '--run', '--json']), /--run requires a value/);
  assert.equal(validateArguments(['--version', '--json']), undefined);
  assert.throws(() => validateArguments(['--version', '--other']), /unexpected version arguments/);
  assert.throws(() => validateArguments(['--version', '--json', '--json']), /unexpected version arguments/);
  assert.equal(commandHelp('doctor'), 'Usage: aegean doctor [--require prerequisites|full] [--json]');
  assert.equal(commandHelp('guide'), 'Usage: aegean guide');
  assert.match(commandHelp(), /Output: text at a terminal; JSON to a pipe or a file, or with --json\./);
});

test('through a pipe, the command line keeps the JSON contract for results and failures', async () => {
  const cli = (args: string[]) => command(process.execPath, [resolve('dist/src/cli.js'), ...args], { timeoutMs: 10000 });
  const version = await cli(['--version']);
  assert.equal(version.code, 0, version.stderr); assert.equal(version.stdout, `${JSON.stringify(JSON.parse(version.stdout), null, 2)}\n`);
  assert.deepEqual(JSON.parse((await cli(['--version', '--json'])).stdout), JSON.parse(version.stdout));
  const failed = await cli(['status', '--run', 'nope']);
  assert.equal(failed.code, 1); assert.equal(failed.stdout, '');
  assert.deepEqual(JSON.parse(failed.stderr), { error: 'invalid run identifier', recovery: 'Copy the complete run identifier from aegean status.' });
});
