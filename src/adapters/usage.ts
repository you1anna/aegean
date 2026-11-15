export interface Usage { input: number | null; output: number | null; cachedInput: number | null }
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function reportedUsage(text: string): Usage {
  const objects: Record<string, unknown>[] = [];
  try { objects.push(JSON.parse(text)); } catch {
    for (const line of text.split('\n')) { try { objects.push(JSON.parse(line)); } catch { /* non-JSON diagnostic */ } }
  }
  const event = objects.findLast(o => o !== null && typeof o === 'object' && typeof o.usage === 'object' && o.usage !== null);
  const usage = (event?.usage ?? {}) as Record<string, unknown>;
  return { input: count(usage.input_tokens), output: count(usage.output_tokens), cachedInput: count(usage.cached_input_tokens ?? usage.cache_read_input_tokens) };
}
export interface ProviderUsage extends Usage { total: number | null; model: string | null; source: string }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** CLI-specific final events, not intermediate message usage or dollar estimates. */
export function providerUsage(text: string, provider: 'claude' | 'codex'): ProviderUsage {
  const source = provider === 'claude' ? 'claude-result-usage' : 'codex-turn-completed';
  const unknown = (): ProviderUsage => ({ input: null, output: null, cachedInput: null, total: null, model: null, source });
  let events: Record<string, unknown>[];
  try {
    const whole: unknown = JSON.parse(text);
    if (!object(whole)) return unknown();
    events = [whole];
  } catch {
    try { events = text.trim().split('\n').filter(Boolean).map(line => { const value: unknown = JSON.parse(line); if (!object(value)) throw new Error(); return value; }); }
    catch { return unknown(); }
  }
  const models = new Set<string>();
  for (const event of events) {
    if (typeof event.model === 'string') models.add(event.model);
    if (object(event.modelUsage)) for (const model of Object.keys(event.modelUsage)) models.add(model);
  }
  if (models.size > 1) return unknown();
  if (provider === 'codex') {
    const turns = events.filter(event => ['turn.started', 'turn.completed', 'turn.failed'].includes(String(event.type)));
    if (turns.at(-1)?.type !== 'turn.completed' || events.some(event => event.type === 'turn.failed' || event.type === 'error')) return unknown();
  }
  const completed = events.filter(event => provider === 'claude' ? event.type === 'result' : event.type === 'turn.completed');
  if (completed.length === 0 || provider === 'claude' && completed.length !== 1) return unknown();
  let input = 0, output = 0, cached = 0;
  const seen = new Map<string, string>(); const anonymous = new Set<string>();
  for (const event of completed) {
    const encoded = JSON.stringify(event);
    if (typeof event.id === 'string') {
      if (seen.has(event.id)) { if (seen.get(event.id) !== encoded) return unknown(); continue; }
      seen.set(event.id, encoded);
    } else { if (anonymous.has(encoded)) return unknown(); anonymous.add(encoded); }
    if (!object(event.usage)) return unknown();
    const u = event.usage; const i = count(u.input_tokens), o = count(u.output_tokens);
    if (i === null || o === null) return unknown();
    const c = count(provider === 'claude' ? u.cache_read_input_tokens : u.cached_input_tokens ?? 0);
    const creation = provider === 'claude' ? count(u.cache_creation_input_tokens) : 0;
    if (c === null || creation === null || provider === 'codex' && c > i) return unknown();
    if (u.reasoning_output_tokens !== undefined && (count(u.reasoning_output_tokens) === null || Number(u.reasoning_output_tokens) > o)) return unknown();
    input += i + (provider === 'claude' ? c + creation : 0); output += o; cached += c;
    if (!Number.isSafeInteger(input + output) || !Number.isSafeInteger(cached)) return unknown();
  }
  return { input, output, cachedInput: cached, total: input + output, model: [...models][0] ?? null, source };
}
