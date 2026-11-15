import { after, before } from 'node:test';

/** Isolate ambient Git config in a serial test-file process, including children. */
export function isolateGitConfig(): void {
  const overrides = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const previous = new Map<string, string | undefined>();
  before(() => {
    for (const [key, value] of Object.entries(overrides)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
  });
  after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
