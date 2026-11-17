import { FINDING_OWNERS, type FindingOwner, type Review } from './config.js';
import { ALLOWED_PATHS } from './allowed-paths.js';

export function publicRequirements(contract: string): Record<string, string> {
  const headings = [...contract.matchAll(/^### Requirement:\s*(.+)$/gm)].map(match => match[1]!.trim().slice(0, 200));
  if (!headings.length || headings.length > 100) throw new Error('contract must contain 1–100 public Requirement headings');
  return Object.fromEntries(headings.map((heading, i) => [`R${String(i + 1).padStart(3, '0')}`, heading]));
}
/** Public verification feedback. The Builder gets it for a repair; the reviewer gets it to find the owner of a fault. */
export function repairFeedback(reason: string, requirements: readonly string[], contract: string, outsidePaths: readonly string[] = []): string[] {
  const messages: Record<string, string> = {
    'candidate-rejected': 'Candidate includes an unsupported path, file type or size; inspect the public adapter limits.',
    'candidate-timeout': 'Candidate exceeded the 15-second execution limit.',
    'candidate-output-limit': 'Candidate exceeded the 128000-byte output limit.',
    'public-check-failed': 'A configured public check failed; run the public checks.',
    'protected-requirement-failed': 'Protected acceptance found a public requirement violation.',
    'outside-allowed-paths': `The candidate changes paths that ${ALLOWED_PATHS} does not allow: ${JSON.stringify(outsidePaths.slice(0, 20).map(path => path.slice(0, 200)))}. Change only the allowed paths.`,
  };
  const available = publicRequirements(contract);
  return [...(messages[reason] ? [messages[reason]!] : []), ...new Set(requirements.filter(id => Object.hasOwn(available, id)).map(id => `${id}: ${available[id]}`))];
}
export function findingCounts(review: Review): Record<FindingOwner, number> {
  return Object.fromEntries(FINDING_OWNERS.map(owner => [owner, review.findings.filter(item => item.owner === owner).length])) as Record<FindingOwner, number>;
}
/** A finding for the specification or for Aegean never reaches the Builder. */
export function builderFindings(review: Review): string[] {
  return review.findings.filter(item => item.owner === 'builder').map(item => item.finding);
}
