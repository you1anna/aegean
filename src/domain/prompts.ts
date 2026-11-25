import { ALLOWED_PATHS } from './allowed-paths.js';
import { caseRules } from './verifier-contract.js';
import type { Project } from './config.js';
import type { Run } from './run.js';

// The prompts that the engine sends to the test Auditor, the Builder and the review Auditor.
// The Scout prompt is in scout.ts with its answer parser. A change to this text changes what each role receives.

/** The test Auditor sees only the approved contract, its public requirement IDs and the public verifier entry point. */
export function testAuditorPrompt(spec: string | undefined, requirements: Record<string, string>, contract: string, command: readonly string[]): string {
  return `Act as independent acceptance-test Auditor. You have no implementation context. Return ONLY JSON {schemaVersion:2,spec:${JSON.stringify(spec)},cases:[{input:string,stdout:string,exit:number,requirement:string}]}. Derive CLI stdin/stdout acceptance cases from this approved contract. ${caseRules(command)} Use only the stdin formats, stdout texts and exit codes that the contract defines. Write each stdout exactly as the contract defines it. Do not write a case that also passes when the entry point is absent. Each requirement must be one of these public requirement IDs: ${JSON.stringify(requirements)}. Do not return free-text feedback.\n${contract}`;
}

export interface ContractFile { readonly path: string; readonly text: string }
export interface BuilderRepair { readonly findings: readonly string[]; readonly feedback: readonly string[] }
/**
 * The Builder prompt before its source context. A repair adds the review findings for the Builder and the public acceptance feedback.
 * The Builder's only tool runs commands in the candidate VM, so the prompt says how to write a file with it.
 */
export function builderPrefix(id: string, checks: Project['checks'], command: readonly string[], contract: readonly ContractFile[], repair?: BuilderRepair): string {
  const feedback = repair ? '\nIndependent review findings: ' + JSON.stringify(repair.findings) + '\nPublic acceptance feedback: ' + JSON.stringify(repair.feedback) : '';
  const files = contract.map(file => `\nFILE ${file.path}\n${file.text}`).join('');
  return `Implement only the approved OpenSpec change ${id}. Read its proposal, design, requirements and tasks. Change only the paths that ${ALLOWED_PATHS} allows; verification fails for a change to another path. Keep the contract, aegean.json and agent configuration unchanged. Do not access hidden tests or credentials. Public test commands: ${JSON.stringify(checks)}. Hidden protected cases check the verifier entry point. ${caseRules(command)} Follow each stdin format, stdout text and exit code of the contract exactly; a failed case tells you only the requirement name. Edit candidate files only with the execute tool, for example args ["sh","-c","mkdir -p src && cat > src/app.mjs"] with the complete file text as input. Append the rest of a file that exceeds the input limit with cat >> path. Your own patch and file tools cannot reach the candidate.${feedback}\nAPPROVED CONTRACT:\n${files}`;
}

/** The review Auditor gets the verification outcome, its public feedback for a failure, the contract and the diff. */
export function reviewerPrompt(verification: Run['verification'], evidence: readonly string[], contract: string, diff: string): string {
  return [
    'Act as a fresh independent code reviewer. Return ONLY JSON {outcome:"pass"|"repair"|"escalate",findings:[{owner:"builder"|"spec"|"factory",finding:string}]}.',
    'Identify actionable defects and security risks. Give each finding one owner:',
    '- builder: a defect in the code that the Builder can correct within the approved contract.',
    '- spec: the contract is wrong, incomplete or contradicts itself, so no correct code can satisfy it.',
    '- factory: a fault in Aegean itself, for example a protected test or the verifier that checks the wrong thing.',
    'A spec or factory finding stops the run, and the Builder gets no repair. Use these owners only when the evidence shows that the Builder cannot correct the fault.',
    `Deterministic verification was ${verification}.${evidence.length ? `\nPUBLIC VERIFICATION FEEDBACK:\n${evidence.join('\n')}` : ''}`,
    `CONTRACT:\n${contract}`,
    `DIFF:\n${diff}`,
  ].join('\n');
}
