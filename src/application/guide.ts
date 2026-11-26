import { basename, join, resolve } from 'node:path';
import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { atomicJson } from '../adapters/files.js';
import { expandHome } from '../adapters/terminal.js';
import { PilotLimitsSchema, parsePilotLimits } from '../domain/pilot-limits.js';
import { GuideStop, ENDED, SPEC_FILES, REQUEST_TEMPLATE, SAVED_REQUEST_CHOICES, LIMIT_FIELDS, requestTitle, checkFix, checkLevel, limitFault, runChoices, type Choice, type GuideUi, type RunFacts } from '../domain/guide.js';
import { reviewFlags, type ReviewSummary } from '../domain/scout.js';
import type { State } from '../domain/run.js';
import { recoveryHint } from './cli-arguments.js';
import type { Readiness } from './runtime.js';

export interface Guide {
  ui: GuideUi;
  /** The command-line dispatch. The guide has no other route to an effect, so each gate stays in its command. */
  execute(args: string[]): Promise<unknown>;
  /** Opens the operator's editor. False means that no editor is set. */
  edit(path: string): Promise<boolean>;
  state: string;
  signal: AbortSignal;
  now(): number;
}
export interface GuideOutcome { run?: string; interrupted: boolean }

interface Listing { runs: { id: string; host: string; state: string }[] }
interface ProjectCheck { base: string; project: { repository: string }; agentContext: { files: { path: string; bytes: number; required: boolean }[]; omitted: string[]; bytes: number; limitBytes: number } }
interface Prepared { id: string; reused: boolean }
interface Resumed { blocked?: string; action?: string; pr?: number }
interface RunStatus { state: State; reason?: string; error?: string; spec?: string; pilot?: { expiresAt: string }; specification?: string; review?: ReviewSummary; next?: string[] }
type Mode = { label: string; echo?: boolean } | 'terminal';

const stop = { value: 'stop', label: 'Stop here' } as const;
const again = { value: 'again', label: 'Try again' } as const;
/** The file list choice that gives paths. No specification file has this name. */
const SHOW_PATHS = 'paths';
/** An edit outside the guide changes the specification head. The approval refuses that head until the edit is recorded. */
const RECORD_EDITS = 'After you save the files, select "Record my edits to the specification".';
const shown = (args: string[]) => `aegean ${args.map(arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`).join(' ')}`;

/** Runs one installed command. A failure is shown with its recovery hint; the caller offers the next choice. */
async function command<T>(g: Guide, args: string[], mode: Mode): Promise<T | undefined> {
  if (mode === 'terminal' || mode.echo !== false) g.ui.note(`$ ${shown(args)}`);
  try { return (mode === 'terminal' ? await g.execute(args) : await g.ui.task(mode.label, () => g.execute(args))) as T; }
  catch (error) {
    if (error instanceof GuideStop) throw error;
    if (g.signal.aborted) throw new GuideStop(true);
    const message = error instanceof Error ? error.message : String(error);
    g.ui.bad(message); g.ui.note(recoveryHint(args[0], message));
    return undefined;
  }
}
async function retry(g: Guide): Promise<void> {
  if (await g.ui.select('What do you want to do?', [again, stop]) === 'stop') throw new GuideStop();
}

async function host(g: Guide): Promise<Readiness> {
  g.ui.step('Host');
  for (;;) {
    const report = await command<Readiness>(g, ['doctor'], { label: 'Check the host' });
    if (!report) { await retry(g); continue; }
    for (const check of report.checks) {
      const level = checkLevel(check);
      if (level === 'pass') g.ui.good(`${check.name}: ${check.detail}`);
      else if (level === 'info') g.ui.note(`  ${check.name}: this release is not accepted. A pilot authorisation covers one run.`);
      else g.ui.bad(`${check.name}: ${check.detail}`);
    }
    if (report.prerequisitesReady) return report;
    const failed = report.checks.filter(check => checkLevel(check) === 'fail');
    const fixes = failed.flatMap(check => checkFix(check.name) ?? []);
    g.ui.warn(`${failed.length} host ${failed.length === 1 ? 'check' : 'checks'} failed. A pilot authorisation and a model call need each check to pass.`);
    g.ui.note(`The operations guide gives the procedure for each check: ${report.operations}`);
    const configured = report.checks.some(check => check.name === 'host-config' && check.ok);
    const choice = await g.ui.select<string>('What do you want to do?', [
      ...fixes.map((fix, n) => ({ value: `fix-${n}`, label: fix.label, hint: shown(fix.command) })),
      { value: 'again', label: 'Check the host again' },
      ...(configured ? [{ value: 'continue', label: 'Continue without these checks', hint: 'a later step can fail' }] : []),
      stop,
    ]);
    if (choice === 'stop') throw new GuideStop();
    if (choice === 'continue') return report;
    const fix = fixes[Number(choice.slice(4))];
    if (fix) await command(g, fix.command, fix.terminal ? 'terminal' : { label: fix.label });
  }
}

/** Returns an unfinished run of this host that the operator selects, or nothing for a new request. */
async function chooseRun(g: Guide, readiness: Readiness): Promise<string | undefined> {
  g.ui.step('Runs');
  for (;;) {
    const listing = await command<Listing>(g, ['status'], { label: 'Read the runs' });
    if (!listing) { await retry(g); continue; }
    const active = listing.runs.filter(run => !ENDED.includes(run.state));
    const mine = active.filter(run => run.host === readiness.host);
    if (active.length > mine.length) g.ui.note(`${active.length - mine.length} unfinished run(s) belong to another host. The guide does not change them.`);
    if (!mine.length) { g.ui.say('This host has no unfinished run.'); return undefined; }
    const choice = await g.ui.select<string>('This host has an unfinished run. What do you want to do?', [
      ...mine.map(run => ({ value: run.id, label: `Continue ${run.id}`, hint: run.state })),
      { value: 'new', label: 'Start a new request' }, stop,
    ]);
    if (choice === 'stop') throw new GuideStop();
    return choice === 'new' ? undefined : choice;
  }
}

async function project(g: Guide): Promise<void> {
  g.ui.step('Project');
  for (;;) {
    const check = await command<ProjectCheck>(g, ['project', 'check'], { label: 'Check the project in this folder' });
    if (!check) { await retry(g); continue; }
    const context = check.agentContext;
    g.ui.good(`${check.project.repository} at revision ${check.base.slice(0, 12)}`);
    g.ui.say('The Scout reads the request, the project checks and these committed files:');
    for (const file of context.files) g.ui.say(`  ${file.path}  ${file.bytes} bytes${file.required ? '' : '  (optional)'}`);
    g.ui.note(`  ${context.bytes} of ${context.limitBytes} bytes. The request and the instructions also use this limit.`);
    if (context.omitted.length) g.ui.warn(`${context.omitted.length} optional file(s) do not fit: ${context.omitted.slice(0, 8).join(', ')}${context.omitted.length > 8 ? ', …' : ''}`);
    g.ui.note('To add a file, commit it and add its path to modelExecution.task.paths in aegean.json.');
    const choice = await g.ui.select('Is this the correct project and file list?', [{ value: 'yes', label: 'Yes, continue' }, { value: 'again', label: 'Check the project again' }, stop]);
    if (choice === 'stop') throw new GuideStop();
    if (choice === 'yes') return;
  }
}

async function writeRequest(g: Guide): Promise<string | undefined> {
  const folder = join(g.state, 'requests');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, `request-${new Date(g.now()).toISOString().replace(/[:.]/g, '-')}.md`);
  await writeFile(path, REQUEST_TEMPLATE, { mode: 0o600, flag: 'wx' });
  if (!await g.edit(path)) {
    g.ui.say(`No editor is set in VISUAL or EDITOR. Write the request in this file: ${path}`);
    if (await g.ui.select('Is the request complete?', [{ value: 'yes', label: 'Yes, the file is saved' }, stop]) === 'stop') throw new GuideStop();
  }
  const text = (await readBoundedEvidenceFile(path, 60_000)).toString('utf8');
  if (text.trim() && text.trim() !== REQUEST_TEMPLATE.trim()) return path;
  g.ui.warn(`The request has no text. The file stays at ${path}`);
  return undefined;
}

/** Requests that the guide saved, newest first. Links, empty requests and unreadable files are left out. */
async function savedRequests(g: Guide): Promise<Choice<string>[]> {
  const folder = join(g.state, 'requests');
  const names = await readdir(folder).catch(() => [] as string[]);
  const found: { path: string; title: string; modified: number }[] = [];
  for (const name of names.filter(name => name.endsWith('.md'))) {
    const path = join(folder, name);
    try {
      const info = await lstat(path);
      if (!info.isFile()) continue;
      const text = (await readBoundedEvidenceFile(path, 60_000)).toString('utf8');
      if (!text.trim() || text.trim() === REQUEST_TEMPLATE.trim()) continue;
      found.push({ path, title: requestTitle(text) ?? name, modified: info.mtimeMs });
    } catch { continue; }
  }
  return found.sort((a, b) => b.modified - a.modified).slice(0, SAVED_REQUEST_CHOICES).map(request => ({
    value: request.path, label: `Use ${request.title}`,
    hint: `${basename(request.path)}, ${new Date(request.modified).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
  }));
}

async function request(g: Guide): Promise<string> {
  g.ui.step('Request');
  g.ui.say('Write the goal, the limits and the tests of success. The Scout proposes the design.');
  for (;;) {
    const saved = await savedRequests(g);
    const source = await g.ui.select<string>('Where is the request?', [
      ...saved,
      { value: 'file', label: saved.length ? 'Use another request file' : 'Use a request file', hint: 'type its path' },
      { value: 'write', label: 'Write the request now', hint: 'opens your editor' }, stop,
    ]);
    if (source === 'stop') throw new GuideStop();
    const path = source === 'file'
      ? resolve(expandHome(await g.ui.text('Path of the request file', { paths: true, validate: value => value ? undefined : 'Give a path.' })))
      : source === 'write' ? await writeRequest(g) : source;
    if (!path) continue;
    const prepared = await command<Prepared>(g, ['prepare', '--request', path], { label: 'Prepare the run' });
    if (!prepared) continue;
    g.ui.good(`${prepared.id}${prepared.reused ? ' is the existing run for this request' : ' is ready'}. No model call occurred.`);
    return prepared.id;
  }
}

async function savedLimits(g: Guide, path: string) {
  try { return PilotLimitsSchema.parse(JSON.parse((await readBoundedEvidenceFile(path, 8192)).toString('utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') g.ui.warn(`The saved limits file is not valid and is not used: ${path}`);
    return undefined;
  }
}

async function authorise(g: Guide, id: string): Promise<void> {
  const own = join(g.state, 'pilot-limits.json'), saved = await savedLimits(g, own);
  const faults = saved ? LIMIT_FIELDS.flatMap(field => { const fault = limitFault(field.key, saved[field.key]); return fault ? [`${field.key} ${saved[field.key]}: ${fault}`] : []; }) : [];
  g.ui.say('The limits apply to this run only. One run has one authorisation; you cannot replace or extend it.');
  g.ui.say('The authorisation must stay valid during your specification review and each later stage. An expired run can only be cancelled.');
  g.ui.note('Token allowances stay in the project aegean.json. The authorisation shows them.');
  if (faults.length) g.ui.warn(`The saved limits cannot finish a run. ${faults.join(' ')}`);
  const choices: Choice<'use' | 'enter' | 'file' | 'back'>[] = [
    ...(saved && !faults.length ? [{ value: 'use', label: 'Use the saved limits', hint: LIMIT_FIELDS.map(field => `${field.key} ${saved[field.key]}`).join(', ') } as const] : []),
    { value: 'enter', label: saved ? 'Enter other limits' : 'Enter the limits', hint: `saved in ${own}` },
    { value: 'file', label: 'Use a limits file' }, { value: 'back', label: 'Go back' },
  ];
  const source = await g.ui.select('Which limits apply to this pilot?', choices);
  if (source === 'back') return;
  let path = own;
  if (source === 'file') path = resolve(expandHome(await g.ui.text('Path of the limits file', { paths: true, validate: value => value ? undefined : 'Give a path.' })));
  if (source === 'enter') {
    const limits: Record<string, number> = { schemaVersion: 1 };
    for (const field of LIMIT_FIELDS) {
      // A saved value that cannot finish a run starts again from the recommended value.
      const initial = saved && !limitFault(field.key, saved[field.key]) ? saved[field.key] : field.initial;
      limits[field.key] = Number(await g.ui.text(field.question, { initial: String(initial), validate: value => /^\d{1,6}$/.test(value) ? limitFault(field.key, Number(value)) : 'Give a whole number.' }));
    }
    try { parsePilotLimits(limits, g.now()); }
    catch (error) { g.ui.bad(error instanceof ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : (error as Error).message); return; }
    await atomicJson(own, limits);
  }
  g.ui.note('Aegean now shows the exact authorisation and the limits. Read them. Type the confirmation yourself.');
  if (await command(g, ['authorize-pilot', '--run', id, '--limits', path], 'terminal')) g.ui.good('The pilot is authorised. No model call occurred.');
}

/** Shows the run. The complete text appears once for each state and specification revision; later it is short. */
function describe(g: Guide, status: RunStatus, facts: RunFacts, expiry: number | undefined, complete: boolean): void {
  if (facts.pilotExpired) { for (const line of status.next ?? []) g.ui.warn(line); return; }
  if (expiry !== undefined && !ENDED.includes(status.state)) {
    const minutes = Math.floor((expiry - g.now()) / 60_000);
    const text = `The pilot authorisation ends in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, at ${new Date(expiry).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. You cannot extend it.`;
    if (minutes < 15) g.ui.warn(`${text} After that time you can only cancel this run.`); else g.ui.note(text);
  }
  const list = (title: string, items: string[]) => { if (items.length) { g.ui.warn(title); for (const item of items) g.ui.say(`  - ${item}`); } };
  switch (status.state) {
    case 'requested':
      if (!status.pilot && !facts.acceptedRelease) g.ui.say('This release has no full acceptance. A pilot authorisation with limits is necessary before the first model call.');
      break;
    case 'spec-drafted':
      if (complete) {
        g.ui.say(`Specification folder: ${status.specification ?? 'not available on this host'}`);
        if (status.review) {
          list('Project rules that limited the request:', status.review.projectRulesThatLimitedTheRequest);
          list('Open questions that you must answer:', status.review.openQuestions);
          list('Needs that the draft does not cover:', status.review.notCovered);
        }
        g.ui.note('The Scout wrote the review notes. They are not verification evidence. Read them before you approve.');
        g.ui.note('Edit only the specification folder. If the request or the project guidance is wrong, cancel the run.');
      }
      if (facts.flags) g.ui.warn(`The draft is not complete: ${facts.flags}. Correct the specification files, or cancel the run and correct the request.`);
      break;
    case 'paused': g.ui.warn(`The run paused: ${status.reason ?? 'no reason recorded; inspect the private diagnostic log'}`); break;
    case 'spec-approved': case 'tests-staged': case 'building': case 'verifying': case 'reviewing': case 'repair':
      g.ui.say('The specification is approved. The next stage makes model calls for the protected tests and the build.');
      g.ui.note('Full delivery remains under evaluation. Read the status document before you continue.');
      break;
    default:
  }
}

/** Gives the folder and each specification file as a path, for an editor outside the terminal. A missing file gets no path. */
async function showPaths(g: Guide, folder: string): Promise<void> {
  const present: string[] = [], absent: string[] = [];
  for (const file of SPEC_FILES) {
    const isFile = await lstat(join(folder, file)).then(info => info.isFile(), () => false);
    (isFile ? present : absent).push(file);
  }
  g.ui.say('Open the specification folder or a file in your editor:');
  g.ui.paths([folder, ...present.map(file => join(folder, file))]);
  if (absent.length) g.ui.note(`No file in this draft: ${absent.join(', ')}`);
  g.ui.note(RECORD_EDITS);
}

/** Shows the specification files one at a time. The cursor moves to the next file after each one. */
async function read(g: Guide, folder: string): Promise<void> {
  const seen = new Set<string>(); let initial: string = SPEC_FILES[0];
  for (;;) {
    const file = await g.ui.select<string>('Which file do you want to read?', [
      ...SPEC_FILES.map(name => ({ value: name, label: name, ...(seen.has(name) ? { hint: 'read' } : {}) })),
      { value: SHOW_PATHS, label: 'Show the file paths for my editor' },
      { value: '', label: 'Go back' },
    ], initial);
    if (!file) return;
    if (file === SHOW_PATHS) { await showPaths(g, folder); initial = ''; continue; }
    let text: string;
    try { text = (await readBoundedEvidenceFile(join(folder, file), 200_000)).toString('utf8'); }
    catch (error) { g.ui.bad(`Cannot read ${file}: ${(error as Error).message}`); continue; }
    await g.ui.page(file, text);
    seen.add(file); initial = SPEC_FILES[SPEC_FILES.indexOf(file as typeof SPEC_FILES[number]) + 1] ?? '';
  }
}

async function runLoop(g: Guide, id: string, readiness: Readiness): Promise<void> {
  let described: string | undefined;
  for (;;) {
    const status = await command<RunStatus>(g, ['status', '--run', id], { label: 'Read the run', echo: false });
    if (!status || status.error) { if (status?.error) g.ui.bad(`${status.error}: ${id}`); await retry(g); continue; }
    g.ui.step(`Run ${id.slice(-8)}: ${status.state}`);
    const expiry = status.pilot ? Date.parse(status.pilot.expiresAt) : undefined;
    const flags = status.review && reviewFlags(status.review);
    const facts: RunFacts = { pilot: Boolean(status.pilot), pilotExpired: expiry !== undefined && expiry <= g.now(), acceptedRelease: readiness.fullWorkflowReady, specification: Boolean(status.specification), ...(flags ? { flags } : {}) };
    const choices = runChoices(status.state, facts), revision = `${status.state} ${status.spec ?? ''}`;
    describe(g, status, facts, expiry, revision !== described); described = revision;
    if (!choices.length) {
      if (ENDED.includes(status.state)) g.ui.say(`This run is ${status.state}${status.reason ? `: ${status.reason}` : ''}. For new work, run: aegean guide`);
      else { g.ui.say('The guide ends at the specification approval. The next steps for this run are:'); for (const line of status.next ?? []) g.ui.say(`  - ${line}`); }
      return;
    }
    const action = await g.ui.select('What do you want to do?', choices);
    if (action === 'stop') throw new GuideStop();
    if (action === 'authorise') await authorise(g, id);
    if (action === 'draft' || action === 'record' || action === 'continue') {
      const label = action === 'draft' ? 'The Scout drafts the specification' : action === 'record' ? 'Record the specification' : 'Continue the run';
      const result = await command<Resumed>(g, ['resume', '--run', id], { label });
      if (result?.blocked) g.ui.warn(result.blocked);
      if (result?.pr && result.action) g.ui.say(`Pull request ${result.pr}: ${result.action}`);
    }
    if (action === 'read' && status.specification) await read(g, status.specification);
    if (action === 'edit' && status.specification) {
      try { if (!await g.edit(status.specification)) g.ui.say(`No editor is set in VISUAL or EDITOR. Open this folder: ${status.specification}`); }
      catch (error) { g.ui.bad((error as Error).message); }
      g.ui.note(RECORD_EDITS);
    }
    if (action === 'approve') {
      if (flags) g.ui.warn(`The draft is not complete: ${flags}. An approval accepts the specification as it is.`);
      if (flags && await g.ui.select('Do you want to approve the draft as it is?', [{ value: 'no', label: 'No, go back' }, { value: 'yes', label: 'Yes, continue to the approval' }]) === 'no') continue;
      g.ui.note('Aegean now shows the request and the exact specification change. Read them. Type the confirmation yourself.');
      if (await command(g, ['approve', '--run', id], 'terminal')) g.ui.good('The specification is approved. The approval names this exact revision.');
    }
    if (action === 'cancel' && await g.ui.select(`Cancel ${id}? You cannot continue a cancelled run.`, [{ value: 'no', label: 'Keep the run' }, { value: 'yes', label: 'Cancel the run' }]) === 'yes')
      await command(g, ['cancel', '--run', id], { label: 'Cancel the run' });
  }
}

/**
 * Interactive route from the host check to the specification approval.
 * It adds no permission: it selects and runs the existing commands, and each human decision keeps its typed confirmation.
 */
export async function guide(g: Guide): Promise<GuideOutcome> {
  let run: string | undefined;
  try {
    g.ui.banner('Aegean guide', [
      'The guide runs the installed commands for you and shows each command.',
      'It covers the host check, the project check, the request, the pilot authorisation and the specification review.',
      'You type each approval yourself. Ctrl-C stops the guide; a run keeps its state.',
    ]);
    const readiness = await host(g);
    run = await chooseRun(g, readiness);
    if (!run) { await project(g); run = await request(g); }
    await runLoop(g, run, readiness);
    return { ...(run ? { run } : {}), interrupted: false };
  } catch (error) {
    if (!(error instanceof GuideStop)) throw error;
    g.ui.say(`\nThe guide stopped.${run ? ` Run ${run} keeps its state.` : ''}`);
    g.ui.note(`To continue, run: aegean guide${run ? `\nTo inspect the run: aegean status --run ${run}` : ''}`);
    return { ...(run ? { run } : {}), interrupted: error.interrupted };
  }
}
