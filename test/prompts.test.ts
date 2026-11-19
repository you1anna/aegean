import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/domain/digest.js';
import { ALLOWED_PATHS } from '../src/domain/allowed-paths.js';
import { testAuditorPrompt, builderPrefix, reviewerPrompt } from '../src/domain/prompts.js';

const id = 'run-00000000-0000-4000-8000-000000000000';
const checks = [['node', '--check', 'app.cjs']];
const contract = ['proposal.md', 'design.md', 'tasks.md', 'specs/contract/spec.md', ALLOWED_PATHS].map(path => ({ path, text: `text of ${path}` }));
const diff = 'diff --git a/app.cjs b/app.cjs\n';

// The digests came from the inline templates in engine.ts before the prompts moved to the domain.
// A prompt change changes what each model role receives. If you change a prompt, give the reason in the PR and update its digest.
test('role prompts keep the exact text that the engine sent before they moved to the domain', () => {
  const cases: [string, string, number][] = [
    [testAuditorPrompt('a'.repeat(64), { R1: 'The CLI prints ok.', R2: 'Exit 0.' }, '# Contract\n\n### Requirement: R1\n'), 'c3f55f6360e0bcceb4b65aed6654022b91443a4823e6d307cf00aa53809a948f', 498],
    [builderPrefix(id, checks, contract), 'c770c6e6a7ddef9cd51534a20503c3808d64edb640f376d27e6c0bf3d93c7b27', 630],
    [builderPrefix(id, checks, contract, { findings: ['Fix the exit code.'], feedback: ['R2 failed: expected exit 0.'] }), '966d035a2e3f5cc3d0f12c664b063fe4d136c74268a1568741b9d0b1acdf378d', 742],
    [reviewerPrompt('pass', [], '# Contract\n', diff), 'f7a41014ad61e884e2f3d3dac6edf4e581fad6da08be451a6bbb17ce731387f1', 795],
    [reviewerPrompt('fail', ['R2 failed: expected exit 0.', 'Outside paths: x'], '# Contract\n', diff), 'db049608676b6833a0ece3083336dc056590628dca7c4bb858c008060f413907', 870],
  ];
  for (const [prompt, hash, bytes] of cases) { assert.equal(Buffer.byteLength(prompt), bytes); assert.equal(digest(prompt), hash); }
});
test('each role prompt carries only its own inputs', () => {
  const auditor = testAuditorPrompt('b'.repeat(64), { R1: 'ok' }, 'CONTRACT TEXT');
  assert.ok(auditor.includes(`spec:"${'b'.repeat(64)}"`)); assert.ok(auditor.includes('{"R1":"ok"}')); assert.ok(auditor.endsWith('\nCONTRACT TEXT'));
  const first = builderPrefix(id, checks, contract);
  assert.ok(!first.includes('Independent review findings') && !first.includes('Public acceptance feedback'));
  assert.ok(first.endsWith(contract.map(file => `\nFILE ${file.path}\n${file.text}`).join('')));
  const repair = builderPrefix(id, checks, contract, { findings: ['F'], feedback: ['P'] });
  assert.ok(repair.includes('\nIndependent review findings: ["F"]\nPublic acceptance feedback: ["P"]\nAPPROVED CONTRACT:\n'));
  assert.ok(!reviewerPrompt('pass', [], 'C', 'D').includes('PUBLIC VERIFICATION FEEDBACK'));
  assert.ok(reviewerPrompt('fail', ['E1', 'E2'], 'C', 'D').includes('Deterministic verification was fail.\nPUBLIC VERIFICATION FEEDBACK:\nE1\nE2\nCONTRACT:\nC\nDIFF:\nD'));
});
