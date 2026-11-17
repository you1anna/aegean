/** The approved specification names the paths that the Builder may create, change or delete. */
export const ALLOWED_PATHS = 'allowed-paths.txt';
const MAX_ENTRIES = 100;

function entry(value: string): string {
  const path = value.trim();
  const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/');
  const unsafe = !path || path.length > 200 || path.startsWith('/') || /[\\\0\r\n]/.test(path)
    || parts.some(part => !part || part === '.' || part === '..' || part === '.git') || path === 'aegean.json';
  if (unsafe) throw new Error('allowed path must be a relative repository path without . or .. parts, .git or aegean.json');
  return path;
}

/** One entry for each line. An entry that ends with / allows each file below that directory. */
export function parseAllowedPaths(text: string): string[] {
  const paths = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(entry);
  if (!paths.length) throw new Error('allowed paths need at least one entry');
  if (paths.length > MAX_ENTRIES) throw new Error(`allowed paths have at most ${MAX_ENTRIES} entries`);
  if (new Set(paths).size !== paths.length) throw new Error('allowed paths contain a repeated entry');
  return paths;
}

export function formatAllowedPaths(paths: readonly string[]): string {
  return ['# Paths that the Builder may create, change or delete. One path on each line.', '# A path that ends with / allows each file below that directory.', ...parseAllowedPaths(paths.join('\n'))].join('\n');
}

/** The run's own change folder is exempt: the import guard already protects it from the Builder. */
export function outsideAllowedPaths(changed: readonly string[], allowed: readonly string[], exempt: string): string[] {
  const permitted = (path: string) => path.startsWith(exempt) || allowed.some(item => item.endsWith('/') ? path.startsWith(item) : path === item);
  return changed.filter(path => !permitted(path));
}
