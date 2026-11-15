// Explicit synthetic native probe; this report does not enable acceptance.
import { mkdir, writeFile, mkdtemp, rm, chmod } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BuilderSession, builderResource } from '../dist/src/adapters/builder-session.js';
import { command } from '../dist/src/adapters/process.js';
import { atomicJson } from '../dist/src/adapters/files.js';
import { docker } from '../dist/src/adapters/container-runtime.js';
import toolchain from '../toolchain.json' with { type: 'json' };

const checks = [];
const check = (name, passed) => { checks.push({ name, passed }); if (!passed) throw new Error(name); };
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report-root' || !isAbsolute(args[1]))) throw new Error('usage: probe-builder-vm.mjs [--report-root NEW_ABSOLUTE_DIRECTORY]');
const reportRoot = args[1] ?? await mkdtemp('/private/tmp/aegean-vm-probe-');
if (args[1]) await mkdir(reportRoot, { mode: 0o700 });
const controller = new AbortController();
process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
let resource; let session;
const resources = [];
async function absent(value) {
  for (const name of [value.writer, value.collector]) {
    const listed = await command('docker', docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']), { timeoutMs: 10_000 });
    if (listed.code !== 0 || listed.interrupted || listed.stdout.trim()) return false;
  }
  const listed = await command('docker', docker(['volume', 'ls', '--filter', `name=^${value.volume}$`, '--format', '{{.Name}}']), { timeoutMs: 10_000 });
  return listed.code === 0 && !listed.interrupted && !listed.stdout.trim();
}
async function nextSession(run = command, signal = controller.signal) {
  controller.signal.throwIfAborted();
  resource = builderResource(randomUUID()); resources.push(resource);
  await mkdir(resource.seed, { recursive: true, mode: 0o755 }); await chmod(dirname(resource.seed), 0o755);
  await writeFile(join(resource.seed, 'public.txt'), 'synthetic public source');
  session = new BuilderSession(resource, value => atomicJson(join(reportRoot, 'resource.json'), value), run, toolchain.verifier.candidateRoot, signal);
  await session.start();
}
async function finishMustReject() {
  try { await session.finish(); return false; } catch { return true; }
}
try {
  await mkdir(toolchain.verifier.candidateRoot, { recursive: true, mode: 0o700 });
  resource = builderResource(randomUUID());
  resources.push(resource);
  await mkdir(resource.seed, { recursive: true, mode: 0o755 }); await chmod(dirname(resource.seed), 0o755);
  const secret = join(dirname(resource.seed), 'outside-canary');
  await writeFile(secret, `synthetic-private-${randomUUID()}`, { mode: 0o600 });
  await writeFile(join(resource.seed, 'public.txt'), 'synthetic public source');
  let waited = false;
  const observedCommand = async (file, args, options) => {
    const result = await command(file, args, options);
    if (!waited && args.includes('rm') && args.includes(resource.writer) && result.code === 0) {
      waited = true; await delay(2500); // detached-child deadline passes before capture
    }
    return result;
  };
  session = new BuilderSession(resource, value => atomicJson(join(reportRoot, 'resource.json'), value), observedCommand, toolchain.verifier.candidateRoot, controller.signal);
  await session.start();
  const inspected = await command('docker', docker(['inspect', resource.writer]), { maxBytes: 128_000 });
  const actual = JSON.parse(inspected.stdout)[0];
  check('resource-configuration', inspected.code === 0 && actual.HostConfig.NetworkMode === 'none' && actual.HostConfig.ReadonlyRootfs && actual.Config.User === '65534:65534' && actual.HostConfig.PidsLimit === 64 && actual.HostConfig.Memory === 512 * 1024 * 1024 && actual.HostConfig.NanoCpus === 1_000_000_000 && actual.HostConfig.CapDrop.includes('ALL') && actual.HostConfig.SecurityOpt.includes('no-new-privileges'));
  check('host-mount-readonly', actual.Mounts.filter(m => m.Type === 'bind').length === 1 && actual.Mounts.filter(m => m.Type === 'bind').every(m => m.Source === resource.seed && m.RW === false));
  const isolation = `const fs=require('node:fs'),net=require('node:net');
const denied=p=>{try{fs.readFileSync(p);return false}catch{return true}};
const blockedWrite=p=>{try{fs.writeFileSync(p,'bad');return false}catch{return true}};
fs.symlinkSync(${JSON.stringify(secret)},'/candidate/escape-link');
const c={outsideReadDenied:denied(${JSON.stringify(secret)}),symlinkReadDenied:denied('/candidate/escape-link'),rootWriteDenied:blockedWrite('/root-write'),seedWriteDenied:blockedWrite('/seed/write'),socketDenied:denied('/var/run/docker.sock'),credentialsDenied:denied('/root/.codex/auth.json')&&denied('/root/.claude.json')};
fs.unlinkSync('/candidate/escape-link');
const sock=net.connect({host:'1.1.1.1',port:443});let done=false;const end=v=>{if(done)return;done=true;sock.destroy();console.log(JSON.stringify({...c,networkDenied:v}))};sock.on('connect',()=>end(false));sock.on('error',()=>end(true));sock.setTimeout(1000,()=>end(false));`;
  const isolated = await session.execute({ args: ['node', '-e', isolation] });
  check('isolation-probe-executed', isolated.code === 0 && !isolated.interrupted);
  for (const [name, value] of Object.entries(JSON.parse(isolated.stdout))) check(name, value === true);
  const spawnWriter = (name, ms) => `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync('/candidate/${name}','observed'),${ms})`)}],{detached:true,stdio:'ignore'});c.unref();`;
  const positive = await session.execute({ args: ['node', '-e', spawnWriter('positive-control', 100)] });
  check('detached-positive-launched', positive.code === 0 && !positive.interrupted);
  await delay(250);
  const observed = await session.execute({ args: ['node', '-e', "process.stdout.write(require('node:fs').readFileSync('positive-control','utf8'))"] });
  check('detached-positive-wrote', observed.code === 0 && observed.stdout === 'observed');
  const negative = await session.execute({ args: ['node', '-e', spawnWriter('late-write', 1500)] });
  check('detached-negative-launched', negative.code === 0 && !negative.interrupted);
  const snapshot = await session.finish();
  check('detached-writer-contained', waited && !snapshot.files.some(f => f.path === 'late-write') && snapshot.files.some(f => f.path === 'positive-control'));
  check('snapshot-after-stop', snapshot.files.some(f => f.path === 'public.txt' && Buffer.from(f.data, 'base64').toString() === 'synthetic public source'));
  let collectorFailure;
  await nextSession(async (file, args, options) => {
    const result = await command(file, args, options);
    if (args.includes('exec') && args.includes(resource.collector) && result.code !== 0 && !result.interrupted) collectorFailure = result;
    return result;
  });
  const nested = await session.execute({ args: ['node', '-e', "const fs=require('node:fs');fs.mkdirSync('nested/.GiT',{recursive:true});fs.writeFileSync('nested/.GiT/config','synthetic');console.log('created')"] });
  check('nested-git-created', nested.code === 0 && nested.stdout.trim() === 'created');
  const rejected = await finishMustReject();
  check('nested-git-denied', rejected && collectorFailure?.code === 1 && /protected snapshot path/.test(collectorFailure.stderr) && await absent(resource));

  await nextSession();
  const timed = await session.execute({ args: ['node', '-e', "process.stdout.write('timeout-started\\n');setInterval(()=>{},1000)"] });
  const timeoutRejected = await finishMustReject();
  check('execution-timeout-contained', timed.interrupted && timed.termination === 'timeout' && timed.stdout.includes('timeout-started') && timed.durationMs >= 15_000 && timeoutRejected && await absent(resource));

  await nextSession();
  const noisy = await session.execute({ args: ['node', '-e', "process.stdout.write('output-started\\n');setTimeout(()=>{process.stdout.write('x'.repeat(250000));setInterval(()=>{},1000)},100)"] });
  const outputRejected = await finishMustReject();
  check('output-limit-contained', noisy.interrupted && noisy.termination === 'output-limit' && noisy.stdout.includes('output-started') && outputRejected && await absent(resource));

  const cancelled = new AbortController();
  await nextSession(command, AbortSignal.any([controller.signal, cancelled.signal]));
  const pending = session.execute({ args: ['node', '-e', "process.stdout.write('cancellation-started\\n');setInterval(()=>{},1000)"] });
  await delay(1000); cancelled.abort(); const interrupted = await pending;
  const cancellationRejected = await finishMustReject();
  check('cancellation-contained', interrupted.interrupted && interrupted.termination === 'aborted' && interrupted.stdout.includes('cancellation-started') && cancellationRejected && await absent(resource));
} catch (error) {
  checks.push({ name: 'probe-completed', passed: false, reason: String(error) }); process.exitCode = 1;
} finally {
  try {
    await session?.abort();
    let cleaned = resources.length > 0;
    for (const value of resources) {
      const stopped = await absent(value); cleaned = stopped && cleaned;
      if (stopped) await rm(dirname(value.seed), { recursive: true, force: true });
    }
    checks.push({ name: 'cleanup-confirmed', passed: cleaned });
    if (!cleaned) process.exitCode = 1;
  }
  catch (error) { checks.push({ name: 'cleanup-confirmed', passed: false, reason: String(error) }); process.exitCode = 1; }
  const report = { schemaVersion: 1, synthetic: true, acceptance: false, checks };
  await atomicJson(join(reportRoot, 'report.json'), report);
  console.log(JSON.stringify({ ...report, reportPath: join(reportRoot, 'report.json') }));
  // Retain report and any cleanup intent. Candidate resources are removed only
  // by confirmed cleanup; do not erase an uncertain resource record here.
}
