import { stripVTControlCharacters } from 'node:util';
import { wrap } from '../adapters/terminal.js';
import { ENDED, checkLevel } from '../domain/guide.js';
import { recoveryHint } from './cli-arguments.js';

/**
 * Command results for a person at a terminal. JSON stays the contract for pipes, files, scripts, agents and tests:
 * this module only changes how a result looks, never which facts a command reports.
 */

/** The data that a command can print as JSON. */
export type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };
export type Style = 'bold' | 'dim' | 'red' | 'green' | 'yellow' | 'cyan';
export type Paint = (style: Style, text: string) => string;
export interface View { width: number; paint: Paint }
export interface ErrorPayload { error: string; recovery: string }

type Scalar = null | boolean | number | string;
type Fields = { [key: string]: Plain };
interface Cell { text: string; style?: Style }

const MAX_ITEMS = 200, MAX_DEPTH = 12, LABEL_LIMIT = 24, MIN_COLUMN = 20;
// Numbers under keys that end in "At" are dates only in this range (years 2000 to 2100), so a counter is never a date.
const FIRST_DATE_MS = 946_684_800_000, LAST_DATE_MS = 4_102_444_800_000;
const ACRONYMS: Record<string, string> = { id: 'ID', pr: 'PR', url: 'URL', sha: 'SHA', vm: 'VM', cli: 'CLI', api: 'API', json: 'JSON', ci: 'CI' };
const GOOD_WHEN_TRUE = new Set(['ready', 'ok', 'passed', 'accepted', 'available', 'valid']);
const BAD_WHEN_TRUE = new Set(['exceeded', 'failed', 'blocked', 'stale', 'interrupted', 'uncertain']);
// Check levels and evidence outcomes share one set of marks.
const MARKS: Record<string, Cell> = { pass: { text: '✔', style: 'green' }, fail: { text: '✖', style: 'red' }, info: { text: '!', style: 'yellow' }, unknown: { text: '?', style: 'yellow' } };
const OUTCOMES: readonly string[] = ['pass', 'fail', 'unknown'];
// C0 and C1 controls except the line feed, and the Unicode bidirectional overrides that can disguise text.
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/** JSON when the operator asks for it or when the output does not go to a terminal. */
export function outputMode(args: readonly string[], terminal: boolean): 'json' | 'text' {
  return terminal && !args.includes('--json') ? 'text' : 'json';
}

/**
 * Converts a result to JSON data with the rules of JSON.stringify. A cycle, a bigint value or a failed toJSON,
 * which make JSON.stringify throw, become strings. Undefined means that JSON has no value for it.
 */
export function toPlain(value: unknown, ancestors: readonly object[] = []): Plain | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string': case 'boolean': return value;
    case 'number': return Number.isFinite(value) ? value : null;
    case 'bigint': return value.toString();
    case 'object': break;
    default: return undefined;
  }
  const object = value as object;
  if (ancestors.includes(object)) return '[circular]';
  const inner = [...ancestors, object];
  const toJSON = (object as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    let replaced: unknown;
    try { replaced = toJSON.call(object, ''); } catch { return '[unserialisable]'; }
    if (replaced !== object) return toPlain(replaced, inner);
  }
  if (Array.isArray(object)) return object.map(item => toPlain(item, inner) ?? null);
  // fromEntries makes "__proto__" an ordinary key, as JSON.parse does.
  return Object.fromEntries(Object.entries(object).flatMap(([key, item]) => { const plain = toPlain(item, inner); return plain === undefined ? [] : [[key, plain]]; }));
}

/** JSON text that never throws. The output for JSON data is the same as JSON.stringify. Undefined gives no text. */
export function toJson(value: unknown, space = 2): string | undefined {
  try { return JSON.stringify(value, null, space); }
  catch { return JSON.stringify(toPlain(value), null, space); }
}

/**
 * Removes terminal control sequences and control characters. Results contain text from processes, repositories
 * and models, which must not move the cursor, clear the screen, change the window title or hide a link.
 */
export function clean(text: string, multiline = false): string {
  const safe = stripVTControlCharacters(text).replace(/\r\n?/g, '\n').replaceAll('\t', '  ').replace(CONTROLS, '');
  return multiline ? safe : safe.replace(/\s*\n\s*/g, ' ');
}

/** A field name for a person: "fullWorkflowReady" becomes "Full workflow ready". A data key, such as a run ID, stays as it is. */
export function label(key: string, value?: Plain): string {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) return clean(key);
  const base = typeof value === 'number' && /[a-z]Ms$/.test(key) ? key.slice(0, -2) : key;
  const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ')
    .map(word => ACRONYMS[word.toLowerCase()] ?? (/^[A-Z]?[a-z0-9]*$/.test(word) ? word.toLowerCase() : word));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A step from a "next" list as its explanation and the commands to type, in order. Other text gives nothing. */
export function splitCommand(step: string): { prose: string; commands: string[] } | undefined {
  const match = /^(.+?):\s+(aegean\s.+)$/.exec(step);
  if (!match) return undefined;
  const commands = match[2]!.split(/,\s*then\s+/);
  return commands.every(command => /^aegean\s[^,]+$/.test(command)) ? { prose: match[1]!, commands } : undefined;
}

/**
 * Finds the JSON in the text output of an installer script. The text is all JSON, or ordinary lines followed by
 * one line of JSON. Other text gives no value; the caller then shows the text unchanged.
 */
export function parseResultText(text: string): { lead: string; value?: Plain } {
  const parse = (candidate: string): Plain | undefined => {
    if (!/^[[{]/.test(candidate)) return undefined;
    try { const value: unknown = JSON.parse(candidate); return value !== null && typeof value === 'object' ? value as Plain : undefined; }
    catch { return undefined; }
  };
  const whole = parse(text.trim());
  if (whole !== undefined) return { lead: '', value: whole };
  const lines = text.trimEnd().split('\n'), last = parse(lines.at(-1)!.trim());
  return last !== undefined && lines.length > 1 ? { lead: lines.slice(0, -1).join('\n'), value: last } : { lead: text };
}

const isFields = (value: Plain | undefined): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: Plain): value is Scalar => value === null || typeof value !== 'object';
const isEmpty = (value: Plain): boolean => Array.isArray(value) ? !value.length : isFields(value) && !Object.keys(value).length;
const isMultiline = (value: Plain): boolean => typeof value === 'string' && clean(value, true).trim().includes('\n');
/** Shown on the same line as its label. */
const isInline = (value: Plain): boolean => isEmpty(value) || isScalar(value) && !isMultiline(value);
const isCheck = (value: Plain): value is { name: string; ok: boolean; detail?: string } => isFields(value) && typeof value.name === 'string' && typeof value.ok === 'boolean'
  && (value.detail === undefined || typeof value.detail === 'string') && Object.keys(value).every(key => ['name', 'ok', 'detail'].includes(key));
/** An evidence observation or another named result with a pass, fail or unknown outcome. */
const isOutcome = (value: Plain): value is Fields & { name: string; outcome: string } => isFields(value) && typeof value.name === 'string'
  && typeof value.outcome === 'string' && OUTCOMES.includes(value.outcome);
const isRow = (value: Plain): value is Fields => isFields(value) && Object.values(value).every(item => isScalar(item) && !isMultiline(item));
const lastWord = (key: string): string => key.split(/(?=[A-Z])/).at(-1)!.toLowerCase();

function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`;
  const total = Math.round(ms / 1000), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min ${total % 60} s`;
}

/** One value as text. The key gives the meaning: a date, a duration, a state, or a flag that is good or bad when true. */
function cell(key: string | undefined, value: Scalar, multiline = false): Cell {
  if (value === null) return { text: 'none', style: 'dim' };
  if (typeof value === 'boolean') {
    const word = key ? lastWord(key) : '';
    const style: Style | undefined = GOOD_WHEN_TRUE.has(word) ? (value ? 'green' : 'red') : BAD_WHEN_TRUE.has(word) && value ? 'red' : undefined;
    return { text: value ? 'yes' : 'no', ...(style ? { style } : {}) };
  }
  if (typeof value === 'number') {
    if (key && /[a-z]At$/.test(key) && Number.isInteger(value) && value >= FIRST_DATE_MS && value <= LAST_DATE_MS)
      return { text: new Date(value).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') };
    if (key && /[a-z]Ms$/.test(key) && value >= 0) return { text: duration(value) };
    return { text: String(value) };
  }
  const text = clean(value, multiline).trim();
  if (!text) return { text: '(empty)', style: 'dim' };
  if (key === 'state') return { text, style: ENDED.includes(value) ? 'dim' : 'bold' };
  if (key === 'outcome' && OUTCOMES.includes(value)) return { text, style: MARKS[value]!.style! };
  return { text };
}

function renderer({ width, paint }: View) {
  const pad = (count: number) => ' '.repeat(count);
  const styled = (part: Cell) => part.style ? paint(part.style, part.text) : part.text;
  /** Wraps text that starts at column `at`. Each next line starts at the same column. */
  const flow = (text: string, at: number) => wrap(text, Math.max(MIN_COLUMN, width - at)).split('\n').join('\n' + pad(at));
  const flowed = (part: Cell, at: number): string => styled({ ...part, text: flow(part.text, at) });
  /** False when a value that starts at column `at` holds a word that `wrap` cannot break to fit the terminal. */
  const fits = (text: string, at: number) => wrap(text, width - at).split('\n').every(line => line.length <= width - at);

  function block(value: Plain, indent: number, depth: number, key?: string): string[] {
    if (depth > MAX_DEPTH) return [pad(indent) + paint('dim', '… nested too deeply; run the command with --json')];
    if (Array.isArray(value)) return list(value, indent, depth, key);
    if (isFields(value)) return fields(value, indent, depth);
    return [pad(indent) + flowed(cell(key, value, true), indent)];
  }

  function fields(value: Fields, indent: number, depth: number, top = false): string[] {
    const out: string[] = [];
    // A top-level error or block is the most important fact, so it comes first. The next steps come last.
    const raised = top ? (['error', 'blocked'] as const).filter(key => typeof value[key] === 'string') : [];
    for (const key of raised) {
      const text = clean(value[key] as string, true).trim() || '(no detail)';
      out.push(key === 'error' ? `${paint('red', '✖')} ${paint('red', flow(text, 2))}` : `${paint('yellow', '!')} ${flow(`Blocked: ${text}`, 2)}`);
    }
    const entries = Object.entries(value).filter(([key]) => !raised.includes(key as 'error') && !(top && key === 'next'));
    const column = Math.min(LABEL_LIMIT, Math.max(0, ...entries.filter(([, item]) => isInline(item)).map(([key, item]) => label(key, item).length)));
    for (const [key, item] of entries) {
      const name = label(key, item);
      if (!isInline(item)) { out.push(pad(indent) + paint('bold', name), ...block(item, indent + 2, depth + 1, key)); continue; }
      const part = isEmpty(item) ? { text: 'none', style: 'dim' as const } : cell(key, item as Scalar);
      const at = indent + Math.max(column, name.length) + 2;
      // A narrow column, or a digest or path wider than the column, moves the value below its label, where it has more room.
      if (width - at < MIN_COLUMN || !fits(part.text, at)) out.push(pad(indent) + name, pad(indent + 2) + flowed(part, indent + 2));
      else out.push(pad(indent) + name.padEnd(column) + '  ' + flowed(part, at));
    }
    const steps = top && value.next !== undefined ? next(value.next) : [];
    if (steps.length) out.push(...(out.length ? [''] : []), ...steps);
    return out;
  }

  function list(items: Plain[], indent: number, depth: number, key?: string): string[] {
    if (!items.length) return [pad(indent) + paint('dim', 'none')];
    const shown = items.slice(0, MAX_ITEMS), out: string[] = [];
    if (shown.every(isCheck)) {
      for (const check of shown) out.push(`${pad(indent)}${styled(MARKS[checkLevel(check)]!)} ${flow(clean(check.name) + (check.detail ? `: ${clean(check.detail)}` : ''), indent + 2)}`);
    } else if (shown.every(isOutcome)) {
      // The mark and the outcome word share the name line; the other fields follow below it.
      for (const { name, outcome, ...rest } of shown) {
        out.push(`${pad(indent)}${styled(MARKS[outcome]!)} ${flow(clean(name), indent + 2)}  ${paint('dim', outcome)}`, ...fields(rest, indent + 2, depth + 1));
      }
    } else if (shown.every(isScalar)) {
      for (const item of shown) out.push(`${pad(indent)}- ${flowed(cell(key, item, true), indent + 2)}`);
    } else {
      const rows = shown.every(isRow) ? table(shown as Fields[], indent) : undefined;
      if (rows) out.push(...rows);
      else shown.forEach((item, n) => {
        const at = indent + String(shown.length).length + 2;
        const lines = block(item, at, depth + 1, key);
        if (!lines.length) lines.push(pad(at) + paint('dim', 'none'));
        lines[0] = pad(indent) + `${n + 1}.`.padEnd(at - indent) + lines[0]!.slice(at);
        out.push(...lines);
      });
    }
    if (items.length > shown.length) out.push(pad(indent) + paint('dim', `… ${items.length - shown.length} more; run the command with --json for the full list`));
    return out;
  }

  /** Rows of flat objects as columns. Undefined when the columns do not fit: a value is never cut. */
  function table(rows: Fields[], indent: number): string[] | undefined {
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    if (!columns.length) return undefined;
    const heads: Cell[] = columns.map(column => ({ text: label(column, rows.find(row => row[column] !== undefined)?.[column]), style: 'bold' }));
    const body = rows.map(row => columns.map(column => row[column] === undefined ? { text: '' } : cell(column, row[column] as Scalar)));
    const widths = columns.map((_, n) => Math.max(heads[n]!.text.length, ...body.map(line => line[n]!.text.length)));
    if (indent + widths.reduce((sum, size) => sum + size, 0) + 2 * (columns.length - 1) > width) return undefined;
    const line = (parts: Cell[]) => pad(indent) + parts.map((part, n) => n === parts.length - 1 ? styled(part) : styled(part) + pad(widths[n]! - part.text.length)).join('  ');
    return [line(heads), ...body.map(line)];
  }

  function next(steps: Plain): string[] {
    if (!Array.isArray(steps) || !steps.every(step => typeof step === 'string')) return [paint('bold', 'Next'), ...block(steps, 2, 1, 'next')];
    if (!steps.length) return [];
    const at = String(steps.length).length + 2, out = [paint('bold', 'Next steps')];
    steps.forEach((step, n) => {
      const text = clean(step).trim(), split = splitCommand(text);
      out.push(`${n + 1}.`.padEnd(at) + flow(split ? `${split.prose}:` : text, at));
      // A command stays on one line, so that a copy of it is complete.
      for (const command of split?.commands ?? []) out.push(pad(at + 2) + paint('cyan', `$ ${command}`));
    });
    return out;
  }

  return (value: Plain): string => {
    const lines = isFields(value) ? fields(value, 0, 0, true) : block(value, 0, 0);
    return lines.length ? lines.join('\n') : paint('dim', 'No details.');
  };
}

/**
 * A command result as text for a terminal. Each fact of the JSON form is in the text. Script output keeps
 * each line, without its control characters: it can contain text from Git, Docker or a shell.
 */
export function renderResult(result: unknown, view: View): string {
  const render = renderer(view);
  if (typeof result === 'string') {
    const parsed = parseResultText(result);
    return parsed.value === undefined ? clean(result, true) : [clean(parsed.lead, true), render(parsed.value)].filter(Boolean).join('\n');
  }
  const value = toPlain(result);
  return value === undefined ? `${view.paint('green', '✔')} Done` : render(value);
}

/** The failure of a command and the advice to recover. Any thrown value gives a message. */
export function errorPayload(error: unknown, command: string | undefined): ErrorPayload {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : toJson(error, 0) ?? String(error)) || 'unknown failure';
  return { error: message, recovery: recoveryHint(command, message) };
}

export function renderError(payload: ErrorPayload, view: View): string {
  const wrapAt = (text: string) => wrap(text, Math.max(MIN_COLUMN, view.width - 2)).split('\n').join('\n  ');
  return `${view.paint('red', '✖')} ${view.paint('red', wrapAt(clean(payload.error, true).trim() || 'unknown failure'))}\n  ${view.paint('dim', wrapAt(clean(payload.recovery, true).trim()))}`;
}
