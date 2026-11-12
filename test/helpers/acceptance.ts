import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { treeDigest, atomicJson } from '../../src/adapters/files.js';
import { evidenceKinds, requiredEvidenceChecks } from '../../src/adapters/acceptance.js';
import { digest } from '../../src/domain/workflow.js';
import { fileHash, releaseArtifacts } from '../../src/adapters/release-artifacts.js';

// Synthetic metadata exclusively for temporary fixture homes. This is not a
// native/provider acceptance writer and must never receive an operator home.
export async function syntheticAcceptance(root: string, state: string, air = randomUUID()) {
  const artifacts=await releaseArtifacts(root); await atomicJson(join(root,'artifact-manifest.json'),artifacts);
  const identity = { sourceHash:'f'.repeat(64), sourceCommit:'a'.repeat(40), buildHash:await treeDigest(join(root,'dist')), artifactHash:digest(JSON.stringify(artifacts)), nodeHash:await fileHash(process.execPath) };
  await atomicJson(join(root,'installation.json'),{schemaVersion:2,...identity});
  const hosts={air,mini:randomUUID()}; const receipts:{path:string;hash:string}[]=[];
  await mkdir(join(state,'acceptance-evidence'),{recursive:true});
  for (const [label,host] of Object.entries(hosts)) for (const kind of [...evidenceKinds,...(label==='air'?['real-pilot']:[])]) {
    const prefix=`acceptance-evidence/${label}-${kind}`;
    const report=JSON.stringify({schemaVersion:1,...identity,kind,host,checks:requiredEvidenceChecks[kind as keyof typeof requiredEvidenceChecks].map(name=>({name,passed:true}))})+'\n';
    await writeFile(join(state,prefix+'-report.json'),report);
    const receipt=JSON.stringify({schemaVersion:1,...identity,host,kind,passed:true,report:{path:prefix+'-report.json',hash:digest(report)}})+'\n';
    await writeFile(join(state,prefix+'.json'),receipt); receipts.push({path:prefix+'.json',hash:digest(receipt)});
  }
  const gate={schemaVersion:2,...identity,hosts,receipts}; await atomicJson(join(state,'acceptance.json'),gate); return gate;
}
