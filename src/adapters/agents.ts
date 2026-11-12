import { realpath, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { command, checked, type Result } from './process.js';
export function subscriptionEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const denied = Object.keys(env).filter(k => /^(OPENAI_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|OPENAI_BASE_URL|ANTHROPIC_BASE_URL)$/.test(k) && env[k]);
  if (denied.length) throw new Error(`subscription-only mode refuses configured API/provider overrides: ${denied.join(', ')}`);
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SYSTEMROOT'];
  return { ...Object.fromEntries(allowed.filter(k => env[k]).map(k => [k, env[k]])), DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
}
export async function authentication(codex: string, claude: string): Promise<{ codex: boolean; claude: boolean }> {
  const env = subscriptionEnvironment(process.env);
  const [a, b] = await Promise.all([
    command(codex, ['login', 'status'], { env }), command(claude, ['auth', 'status'], { env }),
  ]);
  let claudeOk = false;
  try { const s = JSON.parse(b.stdout); claudeOk = b.code === 0 && s.loggedIn === true && s.authMethod === 'claude.ai' && ['pro', 'max', 'ultra', 'team', 'enterprise'].includes(s.subscriptionType); } catch { /* fail closed */ }
  return { codex: a.code === 0 && /Logged in using ChatGPT/.test(a.stdout + a.stderr), claude: claudeOk };
}
export function claudeArgs(): string[] {
  return ['--print', '--safe-mode', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"forceLoginMethod":"claudeai","disableAllHooks":true}', '--tools', '', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--no-chrome', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--model', 'sonnet'];
}
export async function claudeRole(binary: string, prompt: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<Result> {
  const env = subscriptionEnvironment(process.env);
  return command(binary, claudeArgs(), { cwd, env, input: prompt, timeoutMs, maxBytes: 2_000_000, ...(signal ? { signal } : {}) });
}
export function claudeText(result: Result): string {
  if (result.interrupted || result.code !== 0) throw new Error('Claude role interrupted or failed; checkpoint and inspect private diagnostics');
  const data = JSON.parse(result.stdout);
  if (data.is_error || typeof data.result !== 'string') throw new Error('Claude returned an error or invalid result');
  return data.result;
}
export function parseJsonAnswer(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
}
export async function codexPolicy(workspace: string, toolRoot: string): Promise<string[]> {
  const root = await realpath(workspace); const runtime = await realpath(toolRoot);
  const scratch = join(root, '.aegean-tmp'); await mkdir(scratch, { recursive: true, mode: 0o700 });
  const rules: Record<string, string> = { ':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny', '/private/tmp': 'deny', '/System/Library/OpenSSL': 'read', [runtime]: 'read', [dirname(await realpath(process.execPath))]: 'read', [root]: 'write' };
  for (const p of ['.git', '.agents', '.claude', '.codex', '.env', 'aegean.json']) rules[join(root, p)] = 'deny';
  const filesystem = Object.entries(rules).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',');
  return [
    '-c', 'approval_policy="never"', '-c', 'default_permissions="aegean-builder"',
    '-c', `permissions={aegean-builder={filesystem={${filesystem}},network={enabled=false}}}`,
    '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '-c', 'apps={}',
    ...['apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'image_generation', 'multi_agent', 'multi_agent_v2', 'goals', 'memories', 'remote_plugin', 'plugin_discovery_prefetch', 'shell_snapshot', 'unbounded_connection_retries'].flatMap(feature => ['-c', `features.${feature}=false`]),
    '-c', 'features.skip_host_skill_discovery=true',
  ];
}
export async function codexRole(binary: string, prompt: string, workspace: string, toolRoot: string, timeoutMs: number, signal?: AbortSignal): Promise<Result> {
  const env = subscriptionEnvironment(process.env);
  const policy = await codexPolicy(workspace, toolRoot);
  env.TMPDIR = join(await realpath(workspace), '.aegean-tmp');
  return command(binary, ['exec', '--ignore-user-config', '--strict-config', '--ephemeral', '--skip-git-repo-check', '--json', ...policy, '-C', workspace, '-'], { cwd: workspace, env, input: prompt, timeoutMs, maxBytes: 4_000_000, ...(signal ? { signal } : {}) });
}
export async function assertVersion(binary: string, version: string): Promise<void> {
  const actual = await checked(binary, ['--version']);
  if (!new RegExp(`(^|[^\\d])${version.replaceAll('.', '\\.')}([^\\d]|$)`).test(actual)) throw new Error(`tool version drift: expected ${version}`);
}
