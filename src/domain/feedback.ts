export function publicRequirements(contract: string): Record<string, string> {
  const headings = [...contract.matchAll(/^### Requirement:\s*(.+)$/gm)].map(match => match[1]!.trim().slice(0, 200));
  if (!headings.length || headings.length > 100) throw new Error('contract must contain 1–100 public Requirement headings');
  return Object.fromEntries(headings.map((heading, i) => [`R${String(i + 1).padStart(3, '0')}`, heading]));
}
export function repairFeedback(reason: string, requirements: readonly string[], contract: string): string[] {
  const messages: Record<string, string> = {
    'candidate-rejected': 'Candidate includes an unsupported path, file type or size; inspect the public adapter limits.',
    'candidate-timeout': 'Candidate exceeded the 15-second execution limit.',
    'candidate-output-limit': 'Candidate exceeded the 128000-byte output limit.',
    'public-check-failed': 'A configured public check failed; run the public checks.',
    'protected-requirement-failed': 'Protected acceptance found a public requirement violation.',
  };
  const available = publicRequirements(contract);
  return [...(messages[reason] ? [messages[reason]!] : []), ...new Set(requirements.filter(id => Object.hasOwn(available, id)).map(id => `${id}: ${available[id]}`))];
}
