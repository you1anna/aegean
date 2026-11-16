import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesVersion } from '../scripts/cli-version.mjs';

const requirement = '>=2.1.322 <3.0.0';
test('Claude compatibility accepts stable versions within the declared range', () => {
  for (const version of ['2.1.322', '2.1.323', '2.2.0', '2.10.0']) {
    assert.equal(matchesVersion(`${version} (Claude Code)\n`, requirement), true, version);
  }
});
test('Claude compatibility rejects old, major, prerelease and malformed versions', () => {
  for (const version of ['2.1.321', '2.0.999', '3.0.0', '12.1.322', '2.1.323-beta.1', '2.1.323.1', '02.1.323', 'unknown', '2.1.323\n3.0.0']) {
    assert.equal(matchesVersion(`${version} (Claude Code)`, requirement), false, version);
  }
  assert.equal(matchesVersion('2.1.323 (Claude Code)', 'invalid'), false);
});
test('bundled tools keep exact version checks', () => {
  assert.equal(matchesVersion('codex-cli 0.167.2', '0.167.2'), true);
  assert.equal(matchesVersion('codex-cli 0.167.3', '0.167.2'), false);
  assert.equal(matchesVersion('Docker version 29.9.1, build abc', '29.9.1'), true);
});

test('authentication version guard accepts newer Claude and rejects an incompatible version', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { assertVersion } = await import('../dist/src/adapters/agents.js');
  const directory = await mkdtemp(join(tmpdir(), 'aegean-cli-version-'));
  try {
    const binary = join(directory, 'claude');
    await writeFile(binary, '#!/bin/sh\necho "2.1.323 (Claude Code)"\n', { mode: 0o755 });
    await assertVersion(binary, requirement);
    await writeFile(binary, '#!/bin/sh\necho "3.0.0 (Claude Code)"\n', { mode: 0o755 });
    await assert.rejects(assertVersion(binary, requirement), /tool version drift/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('release info reports the actual version and supports older manifests without that record', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { releaseInfo } = await import('../dist/src/application/operator.js');
  const directory = await mkdtemp(join(tmpdir(), 'aegean-version-info-'));
  try {
    await writeFile(join(directory, 'installation.json'), '{}');
    assert.equal((await releaseInfo(directory)).toolVersions, undefined);
    await writeFile(join(directory, 'tool-versions.json'), JSON.stringify({ claude: '2.1.323' }));
    assert.deepEqual((await releaseInfo(directory)).toolVersions, { claude: '2.1.323' });
    await writeFile(join(directory, 'tool-versions.json'), 'invalid');
    await assert.rejects(releaseInfo(directory), SyntaxError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
