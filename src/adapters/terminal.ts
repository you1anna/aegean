import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents, clearScreenDown, moveCursor, clearLine, cursorTo } from 'node:readline';
import { styleText } from 'node:util';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { GuideStop, type Choice, type GuideUi, type TextOptions } from '../domain/guide.js';

type Input = Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
type Output = Writable & { isTTY?: boolean; columns?: number };
interface Key { name?: string; ctrl?: boolean; sequence?: string }
type Colour = Parameters<typeof styleText>[0];

export const expandHome = (path: string): string => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

/** Tab completion for a path question. A failed directory read gives no suggestion. */
export function completePath(line: string): [string[], string] {
  const open = line.endsWith('/') || line === '';
  const base = open ? '' : basename(line), prefix = line.slice(0, line.length - base.length);
  try {
    const directory = open ? expandHome(line) || '.' : dirname(expandHome(line));
    return [readdirSync(directory, { withFileTypes: true }).filter(entry => entry.name.startsWith(base)).map(entry => prefix + entry.name + (entry.isDirectory() ? '/' : '')), line];
  } catch { return [[], line]; }
}

/**
 * Breaks a long line at spaces. A list item keeps its indent on each new line. A word longer than the width stays whole.
 * A command line (`$ ...`) stays on one line, so that a copy of it is complete.
 */
export function wrap(text: string, width: number): string {
  return text.split('\n').map(line => {
    const lead = /^\s*(?:[-*] |\d+\. )?/.exec(line)![0];
    if (line.length <= width || lead.length > width / 2 || line.startsWith('$ ')) return line;
    const indent = ' '.repeat(lead.length), lines: string[] = []; let current = '';
    for (const word of line.slice(lead.length).split(' ')) {
      if (current && indent.length + current.length + 1 + word.length > width) { lines.push(current); current = word; }
      else current = current ? `${current} ${word}` : word;
    }
    return [...lines, current].map((part, n) => (n ? indent : lead) + part).join('\n');
  }).join('\n');
}

/** Shows a text in the operator's pager (PAGER, or less). False means that the pager did not show it. */
export async function openPager(text: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const child = spawn('/bin/sh', ['-c', env.PAGER || 'less'], { stdio: ['pipe', 'inherit', 'inherit'], env });
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
    // The operator can close the pager before it reads all of the text.
    child.stdin.on('error', () => undefined);
    child.stdin.end(text);
  });
}

/** Opens the operator's own editor on a private file or folder. Never use for candidate code. */
export async function openEditor(path: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const editor = env.VISUAL || env.EDITOR;
  if (!editor) return false;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', `${editor} "$1"`, 'sh', path], { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`the editor stopped with ${signal ?? code}`)));
  });
  return true;
}

/**
 * Draws the guide on an interactive terminal. It has no unattended mode:
 * the guide leads to human decisions, and an agent must not operate it.
 */
export function terminalUi(input: Input = process.stdin, output: Output = process.stdout, pager: (text: string) => Promise<boolean> = openPager): GuideUi {
  if (!input.isTTY || !output.isTTY) throw new Error('The guide requires the operator at an interactive terminal. Use aegean status for the next step, or aegean help for the commands');
  const paint = (colour: Colour, text: string) => styleText(colour, text, { stream: output });
  let spinner: { clear(): void; draw(): void } | undefined;
  const print = (text: string) => { spinner?.clear(); output.write(text + '\n'); spinner?.draw(); };
  const width = () => (output.columns && output.columns >= 20 ? output.columns : 80) - 1;
  const fit = (text: string) => text.length > width() ? text.slice(0, Math.max(0, width() - 1)) + '…' : text;
  const marked = (mark: string, text: string) => print(`${mark} ${wrap(text, width() - 2).replaceAll('\n', '\n  ')}`);
  const ui: GuideUi = {
    banner(title, lines) { print(`\n${paint('bold', title)}\n${paint('dim', wrap(lines.join('\n'), width()))}`); },
    step(title) { print(`\n${paint(['bold', 'cyan'], title)}`); },
    say(text) { print(wrap(text, width())); },
    note(text) { print(paint('dim', wrap(text, width()))); },
    good(text) { marked(paint('green', '✔'), text); },
    warn(text) { marked(paint('yellow', '!'), text); },
    bad(text) { marked(paint('red', '✖'), text); },
    async select<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T> {
      if (!choices.length) throw new Error('a question needs at least one choice');
      let index = Math.max(0, choices.findIndex(choice => choice.value === initial)), chosen = false;
      const frame = () => [
        `${paint('cyan', '?')} ${paint('bold', fit(question))}`,
        ...choices.map((choice, n) => {
          const plain = fit(`  ${n + 1}. ${choice.label}${choice.hint ? `  (${choice.hint})` : ''}`);
          return n === index ? paint('cyan', `❯${plain.slice(1)}`) : plain;
        }),
        paint('dim', fit('  Use the arrow keys or a number. Press Enter to select.')),
      ];
      let drawn = 0;
      const draw = () => { if (drawn) { moveCursor(output, 0, -drawn); cursorTo(output, 0); clearScreenDown(output); } const lines = frame(); drawn = lines.length; output.write(lines.join('\n') + '\n'); };
      emitKeypressEvents(input); input.setRawMode?.(true); input.resume(); draw();
      try {
        return await new Promise<T>((resolve, reject) => {
          const onKey = (text: string | undefined, key: Key = {}) => {
            const digit = /^[1-9]$/.test(text ?? '') ? Number(text) - 1 : -1;
            if (key.ctrl && key.name === 'c') finish(() => reject(new GuideStop(true)));
            else if (key.name === 'up' || key.name === 'k') { index = (index + choices.length - 1) % choices.length; draw(); }
            else if (key.name === 'down' || key.name === 'j') { index = (index + 1) % choices.length; draw(); }
            else if (digit >= 0 && digit < choices.length) { index = digit; draw(); }
            else if (key.name === 'return' || key.name === 'enter') finish(() => { chosen = true; resolve(choices[index]!.value); });
          };
          const onEnd = () => finish(() => reject(new GuideStop(true)));
          const finish = (settle: () => void) => { input.off('keypress', onKey); input.off('end', onEnd); settle(); };
          input.on('keypress', onKey); input.once('end', onEnd);
        });
      } finally {
        input.setRawMode?.(false); input.pause();
        moveCursor(output, 0, -drawn); cursorTo(output, 0); clearScreenDown(output);
        if (chosen) output.write(`${paint('green', '✔')} ${fit(`${question} ${choices[index]!.label}`)}\n`);
      }
    },
    async text(question: string, options: TextOptions = {}): Promise<string> {
      const prompt = createInterface({ input, output, ...(options.paths ? { completer: completePath } : {}) });
      const stop = new AbortController();
      prompt.once('SIGINT', () => stop.abort()); prompt.once('close', () => stop.abort());
      try {
        for (;;) {
          const answer = (await prompt.question(`${paint('cyan', '?')} ${paint('bold', question)}${options.initial ? paint('dim', ` (${options.initial})`) : ''}: `, { signal: stop.signal })).trim() || options.initial || '';
          const fault = options.validate?.(answer);
          if (!fault) return answer;
          output.write(`${paint('red', '✖')} ${fault}\n`);
        }
      } catch (error) {
        if (stop.signal.aborted) { output.write('\n'); throw new GuideStop(true); }
        throw error;
      } finally { prompt.close(); }
    },
    async task<T>(label: string, work: () => Promise<T>): Promise<T> {
      const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', started = Date.now(); let tick = 0;
      const seconds = () => `${Math.floor((Date.now() - started) / 1000)} s`;
      const clear = () => { clearLine(output, 0); cursorTo(output, 0); };
      const draw = () => { clear(); output.write(fit(`${frames[tick % frames.length]} ${label} ${seconds()}`)); };
      spinner = { clear, draw }; draw();
      const timer = setInterval(() => { tick++; draw(); }, 120);
      const end = (mark: string) => { clearInterval(timer); spinner = undefined; clear(); output.write(`${mark} ${label} ${paint('dim', `(${seconds()})`)}\n`); };
      try { const value = await work(); end(paint('green', '✔')); return value; }
      catch (error) { end(paint('red', '✖')); throw error; }
    },
    async page(title: string, text: string): Promise<void> {
      const body = wrap(text.trimEnd(), width());
      if (await pager(`${title}  (Space: next page, q: close)\n\n${body}\n`)) { ui.good(`Read ${title}`); return; }
      // Without a pager the text stays on the screen until the operator answers.
      print(`\n${paint('bold', title)}\n\n${body}\n`);
      await ui.select(`End of ${title}`, [{ value: 'back', label: 'Go back' }]);
    },
  };
  return ui;
}
