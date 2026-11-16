// Pure compatibility rules shared by source installation and compiled commands.
const stable = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)';
const exact = new RegExp(`^${stable}$`);

/** @param {string} value */
export function isStableVersion(value) { return typeof value === 'string' && exact.test(value); }

/** Numeric order of two stable versions. @param {string} left @param {string} right @returns {-1 | 0 | 1} */
export function compareVersions(left, right) {
  const a = left.split('.').map(BigInt); const b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** @param {string} output @returns {string | undefined} */
export function reportedVersion(output) {
  const line = output.trim();
  if (/[\r\n]/.test(line)) return undefined;
  return line.match(new RegExp(`^(?:[A-Za-z][A-Za-z -]* )?(${stable})(?=$|[ ,])`))?.[1];
}

/** @param {string} output @param {string} requirement */
export function matchesVersion(output, requirement) {
  const actual = reportedVersion(output);
  if (!actual || typeof requirement !== 'string') return false;
  if (exact.test(requirement)) return actual === requirement;
  const range = requirement.match(new RegExp(`^>=(${stable}) <(${stable})$`));
  if (!range) return false;
  return compareVersions(actual, range[1]) >= 0 && compareVersions(actual, range[2]) < 0;
}
