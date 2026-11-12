import { command } from './process.js';
import toolchain from '../../toolchain.json' with { type: 'json' };

export const docker = (args: string[]): string[] => ['--context', `colima-${toolchain.verifier.profile}`, ...args];

// A failed/lost removal response is not proof of absence. Query the daemon;
// unknown state keeps the caller's durable cleanup intent and ownership.
export async function removeContainer(name: string, execute = command): Promise<boolean> {
  try {
    const removed = await execute('docker', docker(['rm', '--force', name]), { timeoutMs: 10_000 });
    if (removed.code === 0 && !removed.interrupted) return true;
    const listed = await execute('docker', docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']), { timeoutMs: 10_000 });
    return listed.code === 0 && !listed.interrupted && listed.stdout.trim() === '';
  } catch { return false; }
}

export async function removeVolume(name: string, execute = command): Promise<boolean> {
  try {
    const removed = await execute('docker', docker(['volume', 'rm', name]), { timeoutMs: 10_000 });
    if (removed.code === 0 && !removed.interrupted) return true;
    const listed = await execute('docker', docker(['volume', 'ls', '--filter', `name=^${name}$`, '--format', '{{.Name}}']), { timeoutMs: 10_000 });
    return listed.code === 0 && !listed.interrupted && listed.stdout.trim() === '';
  } catch { return false; }
}
