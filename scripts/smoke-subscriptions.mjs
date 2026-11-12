import { realpath, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = await realpath(join(homedir(), '.local/share/aegean/current'));
const module = name => import(pathToFileURL(join(root, 'dist/src', name + '.js')));
const { hostConfig, binaries, stateRoot } = await module('application/runtime');
const { authentication, claudeRole, claudeText, parseJsonAnswer, codexRole } = await module('adapters/agents');
const { atomicJson } = await module('adapters/files');
const { reportedUsage } = await module('adapters/usage');
const config = await hostConfig();
if (!config.billingConfirmed) throw new Error('Operator billing confirmation required');
const bins = binaries(root);
const auth = await authentication(bins.codex, bins.claude);
if (!auth.codex || !auth.claude) throw new Error('Both subscription logins required');
const scratch = await mkdtemp('/private/tmp/aegean-subscription-smoke-');
const evidence = join(stateRoot(), 'acceptance-evidence', 'subscription-smoke-' + new Date().toISOString().replaceAll(':', '-'));
await mkdir(evidence, { recursive: true, mode: 0o700 });
const installation = JSON.parse(await readFile(join(root, 'installation.json'), 'utf8'));
const receipt = { sourceHash: installation.sourceHash, startedAt: new Date().toISOString(), subscriptionAuthenticated: auth, roles: [] };
try {
  const work = join(scratch, 'work'); await mkdir(work);
  const claude = await claudeRole(bins.claude, 'This is a synthetic subscription smoke test. Return exactly this JSON and nothing else: {"ok":true}. Do not use tools.', work, 90000);
  await atomicJson(join(evidence, 'claude-private-result.json'), claude);
  let passed = false; try { passed = parseJsonAnswer(claudeText(claude)).ok === true; } catch {}
  receipt.roles.push({ role: 'claude', passed, code: claude.code, interrupted: claude.interrupted, durationMs: claude.durationMs, usage: reportedUsage(claude.stdout) });
  console.log(JSON.stringify(receipt.roles.at(-1)));
  if (!passed) console.log(JSON.stringify({ diagnostic: claude.stderr.slice(0, 2000) }));
  const codex = await codexRole(bins.codex, 'Synthetic subscription and sandbox smoke test. Use a shell tool to create smoke.txt in the current workspace containing exactly aegean-smoke-ok followed by one newline. Do not read any other files, invoke subagents, or access the network. Then reply exactly SMOKE_OK.', work, root, 90000);
  await atomicJson(join(evidence, 'codex-private-result.json'), codex);
  let content = ''; try { content = await readFile(join(work, 'smoke.txt'), 'utf8'); } catch {}
  const events = codex.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const codexPassed = codex.code === 0 && !codex.interrupted && content === 'aegean-smoke-ok\n' && events.some(e => e.type === 'turn.completed');
  receipt.roles.push({ role: 'codex', passed: codexPassed, code: codex.code, interrupted: codex.interrupted, durationMs: codex.durationMs, workspaceWrite: content === 'aegean-smoke-ok\n', usage: reportedUsage(codex.stdout) });
  console.log(JSON.stringify(receipt.roles.at(-1)));
  if (!codexPassed) console.log(JSON.stringify({ diagnostic: codex.stderr.slice(0, 2000) }));
  if (!receipt.roles.every(r => r.passed)) process.exitCode = 1;
} finally {
  await atomicJson(join(evidence, 'receipt.json'), { ...receipt, finishedAt: new Date().toISOString() });
  await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ evidence }));
}
