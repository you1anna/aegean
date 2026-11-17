import { styleText } from 'node:util';
import type { Writable } from 'node:stream';

type Output = Writable & { isTTY?: boolean; getColorDepth?: () => number };

/**
 * The Aegean mark in Braille cells, traced from docs/images/aegean.png (the logo area, 32 columns).
 * Each TONES character gives the colour of the cell above it: 0 cool, 1 pale, 2 peach, 3 sunrise.
 */
const MARK = [
  '            ⢀⣴⣶⣦⡀',
  '           ⣰⣿⠿⠿⠿⣿⣦⡀',
  '         ⢀⣾⠟⠁    ⠙⢿⣦⡀',
  '        ⣠⠟⠁       ⠈⢿⣿⣄',
  '      ⢀⠜⠁        ⣀⣀⣸⣿⣿⣆',
  '     ⢠⠊  ⢀⣀⣤⣴⠶⠾⠿⠿⠿⠿⣿⣿⣿⣿⣆',
  '    ⣴⣇⣠⣴⠾⠛⠉⠁        ⠈⠙⠻⢿⣦',
  '  ⣠⣾⡿⠟⠋                 ⠉⠳⡄',
  '⠠⠚⠋⠁                      ⠈',
] as const;
const TONES = [
  '            23333',
  '           00133333',
  '         0000    3333',
  '        000       3333',
  '      000        233333',
  '     00  000033333333333',
  '    00000000        23333',
  '  00000                 221',
  '0000                      1',
] as const;
/** Mid-tone colours, so that the mark shows on a dark and on a light background. */
const RGB: readonly (readonly [number, number, number])[] = [[120, 160, 214], [158, 186, 226], [236, 170, 120], [240, 140, 72]];
const NAMED = ['cyan', 'cyan', 'yellow', 'yellow'] as const;

export const WORDMARK = 'Λ   E   G   E   Λ   N';
export const MARK_WIDTH = Math.max(...MARK.map(line => line.length));
const MARGIN = '  ';

/** Colour depth in bits: 24 true colour, 8 for 256 colours, 4 for named colours, 1 for none. NO_COLOR and TERM=dumb give 1. */
export function colourDepth(output: Output): number {
  if (typeof output.getColorDepth === 'function') return output.getColorDepth();
  return styleText('red', 'x', { stream: output }) === 'x' ? 1 : 4;
}

function tint(tone: number, text: string, depth: number, output: Output): string {
  const [r, g, b] = RGB[tone]!;
  if (depth >= 24) return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
  if (depth >= 8) { const six = (value: number) => Math.round(value / 255 * 5); return `\x1b[38;5;${16 + 36 * six(r) + 6 * six(g) + six(b)}m${text}\x1b[39m`; }
  if (depth >= 4) return styleText(NAMED[tone]!, text, { stream: output });
  return text;
}

/** Paints each run of cells that have the same tone. A space has no colour. */
function paintMark(line: string, tones: string, depth: number, output: Output): string {
  let result = '', run = '', tone = '';
  const flush = () => { if (run) result += tone === ' ' ? run : tint(Number(tone), run, depth, output); run = ''; };
  [...line].forEach((cell, n) => { const next = cell === ' ' ? ' ' : tones[n] ?? '0'; if (next !== tone) { flush(); tone = next; } run += cell; });
  flush();
  return result;
}

/**
 * The mark and the wordmark for a terminal of the given width.
 * A terminal narrower than the mark gets the wordmark only. No line is longer than the width.
 */
export function brandLines(width: number, output: Output): string[] {
  const depth = colourDepth(output), bold = (text: string) => styleText('bold', text, { stream: output });
  if (width < MARGIN.length + MARK_WIDTH) return [WORDMARK.length + MARGIN.length <= width ? MARGIN + bold(WORDMARK) : bold('AEGEAN')];
  const centre = ' '.repeat(Math.floor((MARK_WIDTH - WORDMARK.length) / 2));
  return [...MARK.map((line, n) => MARGIN + paintMark(line, TONES[n]!, depth, output)), '', MARGIN + centre + bold(WORDMARK)];
}
