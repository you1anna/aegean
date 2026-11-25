import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/domain/digest.js';
import { ALLOWED_PATHS } from '../src/domain/allowed-paths.js';
import { testAuditorPrompt, builderPrefix, reviewerPrompt } from '../src/domain/prompts.js';
import { CASE_LIMITS, caseRules } from '../src/domain/verifier-contract.js';

const id = 'run-00000000-0000-4000-8000-000000000000';
const checks = [['node', '--check', 'app.cjs']];
const verifier = ['node', 'app.cjs'];
const contract = ['proposal.md', 'design.md', 'tasks.md', 'specs/contract/spec.md', ALLOWED_PATHS].map(path => ({ path, text: `text of ${path}` }));
const diff = 'diff --git a/app.cjs b/app.cjs\n';

// The digests came from the inline templates in engine.ts before the prompts moved to the domain.
// A prompt change changes what each model role receives. If you change a prompt, give the reason in the PR and update its digest.
// Policy 0.8.0: the test Auditor and the Builder get the verifier entry point and the case rules; the Builder learns how to write files.
test('role prompts keep the exact text that the engine sent before they moved to the domain', () => {
  const cases: [string, string, number][] = [
    [testAuditorPrompt('a'.repeat(64), { R1: 'The CLI prints ok.', R2: 'Exit 0.' }, '# Contract\n\n### Requirement: R1\n', verifier), 'f17f45630c38a0fab1469727f39d616c3d9388b99f26dd132f9550376cf78f84', 1266],
    [builderPrefix(id, checks, verifier, contract), '53f6a4982705f047c916378da94c2e1a7ccd4c3a131f353e886c76528cc8c0c5', 1658],
    [builderPrefix(id, checks, verifier, contract, { findings: ['Fix the exit code.'], feedback: ['R2 failed: expected exit 0.'] }), 'be2fa899d0bed782b7f54a4ac2530afc948c7be94140bf9ec7a2ce82029688d8', 1770],
    [reviewerPrompt('pass', [], '# Contract\n', diff), 'f7a41014ad61e884e2f3d3dac6edf4e581fad6da08be451a6bbb17ce731387f1', 795],
    [reviewerPrompt('fail', ['R2 failed: expected exit 0.', 'Outside paths: x'], '# Contract\n', diff), 'db049608676b6833a0ece3083336dc056590628dca7c4bb858c008060f413907', 870],
  ];
  for (const [prompt, hash, bytes] of cases) { assert.equal(Buffer.byteLength(prompt), bytes); assert.equal(digest(prompt), hash); }
});
test('the test Auditor and the Builder get the verifier entry point and the exact case rules; the Builder learns how to write files', () => {
  const command = ['node', 'bin/acceptance.mjs'], rules = caseRules(command);
  // The rules name the exact command and the limits that the suite schema and the verifier adapter enforce.
  assert.ok(rules.includes('["node","bin/acceptance.mjs"]')); assert.match(rules, /complete stdout/); assert.match(rules, /no other arguments/);
  for (const limit of [`${CASE_LIMITS.textChars} characters`, `${CASE_LIMITS.seconds} seconds`, `${CASE_LIMITS.tmpMegabytes} MB`, `${CASE_LIMITS.outputBytes} bytes`]) assert.ok(rules.includes(limit), limit);
  assert.match(rules, /exits with code 1 and prints no stdout/);
  const auditor = testAuditorPrompt('b'.repeat(64), { R001: 'ok' }, 'CONTRACT TEXT', command);
  assert.ok(auditor.includes(rules)); assert.match(auditor, /Do not write a case that also passes when the entry point is absent/); assert.ok(auditor.endsWith('\nCONTRACT TEXT'));
  const builder = builderPrefix(id, checks, command, contract);
  assert.ok(builder.includes(rules)); assert.ok(builder.includes('["sh","-c","mkdir -p src && cat > src/app.mjs"]')); assert.match(builder, /cat >> /);
  assert.match(builder, /patch and file tools cannot reach the candidate/);
  // The Builder never sees a protected case: only the rules and the public contract.
  assert.ok(!builder.includes('"cases"'));
});

test('each role prompt carries only its own inputs', () => {
  const auditor = testAuditorPrompt('b'.repeat(64), { R1: 'ok' }, 'CONTRACT TEXT', verifier);
  assert.ok(auditor.includes(`spec:"${'b'.repeat(64)}"`)); assert.ok(auditor.includes('{"R1":"ok"}')); assert.ok(auditor.endsWith('\nCONTRACT TEXT'));
  const first = builderPrefix(id, checks, verifier, contract);
  assert.ok(!first.includes('Independent review findings') && !first.includes('Public acceptance feedback'));
  assert.ok(first.endsWith(contract.map(file => `\nFILE ${file.path}\n${file.text}`).join('')));
  const repair = builderPrefix(id, checks, verifier, contract, { findings: ['F'], feedback: ['P'] });
  assert.ok(repair.includes('\nIndependent review findings: ["F"]\nPublic acceptance feedback: ["P"]\nAPPROVED CONTRACT:\n'));
  assert.ok(!reviewerPrompt('pass', [], 'C', 'D').includes('PUBLIC VERIFICATION FEEDBACK'));
  assert.ok(reviewerPrompt('fail', ['E1', 'E2'], 'C', 'D').includes('Deterministic verification was fail.\nPUBLIC VERIFICATION FEEDBACK:\nE1\nE2\nCONTRACT:\nC\nDIFF:\nD'));
});
