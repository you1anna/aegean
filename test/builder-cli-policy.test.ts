import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderCliPolicy } from '../src/adapters/builder-cli-policy.js';

test('Builder host policy has no provider override or writable host grant', () => {
  const args = builderCliPolicy('/trusted/node', ['/trusted/bridge.mjs', 'quoted "argument"'], '/trusted/empty');
  const settings = args.filter((_, i) => i % 2 === 1).join('\n');
  assert.equal(args.filter((_, i) => i % 2 === 0).every(v => v === '-c'), true);
  assert.match(settings, /approval_policy="never"/);
  assert.match(settings, /":root"="deny"/);
  assert.match(settings, /"\/trusted\/empty"="read"/);
  assert.doesNotMatch(settings, /="write"|model_provider|api_key|base_url/);
  assert.match(settings, /required=true,enabled_tools=\["execute"\],tools=\{execute=\{approval_mode="approve"\}\}/);
  assert.match(settings, /agents.max_threads=1/);
  assert.match(settings, /agents.enabled=false/);
  assert.match(settings, /project_doc_max_bytes=0/);
  assert.match(settings, /skills.bundled.enabled=false/);
  assert.match(settings, /skills.include_instructions=false/);
  assert.match(settings, /developer_instructions="You are the Builder inside an already approved Aegean run/);
  for (const feature of ['shell_tool', 'unified_exec', 'js_repl', 'apps', 'plugins', 'hooks', 'multi_agent', 'multi_agent_v2', 'workspace_dependencies']) {
    assert.ok(settings.includes(`features.${feature}=false`));
  }
  assert.match(settings, /features.code_mode_host=true/);
});

test('Builder policy rejects ambiguous paths and control-character arguments', () => {
  assert.throws(() => builderCliPolicy('node', [], '/trusted/empty'), /absolute/);
  assert.throws(() => builderCliPolicy('/trusted/node', [], 'relative'), /absolute/);
  assert.throws(() => builderCliPolicy('/trusted/node', [], '/'), /absolute/);
  assert.throws(() => builderCliPolicy('/trusted/node', [], '/trusted/..'), /absolute/);
  assert.throws(() => builderCliPolicy('/trusted/node', ['bad\nargument'], '/trusted/empty'), /single-line/);
});
