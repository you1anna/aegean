import test from 'node:test';
import assert from 'node:assert/strict';
import { command } from '../src/adapters/process.js';

test('process output preserves UTF-8 characters split across stdout and stderr chunks', async () => {
  const result = await command(process.execPath, ['-e', `
const bytes=Buffer.from('λ😀');
process.stdout.write(bytes.subarray(0,1));process.stderr.write(bytes.subarray(0,3));
setTimeout(()=>{process.stdout.write(bytes.subarray(1));process.stderr.write(bytes.subarray(3));},30);
`]);
  assert.equal(result.code, 0); assert.equal(result.interrupted, false);
  assert.equal(result.stdout, 'λ😀'); assert.equal(result.stderr, 'λ😀');
});
