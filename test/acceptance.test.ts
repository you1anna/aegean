import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acceptedRelease } from '../src/adapters/acceptance.js';
import { syntheticAcceptance } from './helpers/acceptance.js';
import { digest } from '../src/domain/workflow.js';

test('release acceptance rejects flags, missing hosts, stale receipts, edited reports and build drift', async () => {
  const parent=await mkdtemp(join(tmpdir(),'aegean-acceptance-test-')); const root=join(parent,'release');const state=join(parent,'state');
  try {
    await mkdir(join(root,'dist'),{recursive:true}); await writeFile(join(root,'dist/app.js'),'synthetic build');
    const gate=await syntheticAcceptance(root,state); await acceptedRelease(root,state);
    await assert.rejects(acceptedRelease(root,state,{sourceHash:gate.sourceHash,builderIsolation:true,protectedVerifier:true,liveLoop:true}));
    await assert.rejects(acceptedRelease(root,state,{...gate,hosts:{air:gate.hosts.air,mini:gate.hosts.air}}),/distinct/);
    await assert.rejects(acceptedRelease(root,state,{...gate,sourceCommit:'b'.repeat(40)}),/stale/);
    await assert.rejects(acceptedRelease(root,state,gate,'267fd10d-f2ff-4ac5-bb8c-71e4564b14e4'),/this host/);
    const receipt=join(state,gate.receipts[0]!.path); const before=await readFile(receipt,'utf8');
    await writeFile(receipt,before+' '); await assert.rejects(acceptedRelease(root,state),/evidence content changed/); await writeFile(receipt,before);
    const receiptData=JSON.parse(before);const report=join(state,receiptData.report.path);const originalReport=await readFile(report,'utf8');
    const incomplete=JSON.parse(originalReport);incomplete.checks=incomplete.checks.filter((check:{name:string})=>check.name!=='detached-writer-contained');const incompleteText=JSON.stringify(incomplete);
    await writeFile(report,incompleteText);receiptData.report.hash=digest(incompleteText);const incompleteReceipt=JSON.stringify(receiptData);await writeFile(receipt,incompleteReceipt);
    await assert.rejects(acceptedRelease(root,state,{...gate,receipts:gate.receipts.map((item,i)=>i===0?{...item,hash:digest(incompleteReceipt)}:item)}),/required passing checks/);
    await writeFile(receipt,before);await writeFile(report,'changed'); await assert.rejects(acceptedRelease(root,state),/report content changed/);
    receiptData.report.hash=digest('changed');const edited=JSON.stringify(receiptData);await writeFile(receipt,edited);
    const editedGate={...gate,receipts:gate.receipts.map((item,i)=>i===0?{...item,hash:digest(edited)}:item)};
    await assert.rejects(acceptedRelease(root,state,editedGate),/JSON|Unexpected token/);
    await syntheticAcceptance(root,state);await writeFile(join(root,'extra-executable'),'same version, different code');
    await assert.rejects(acceptedRelease(root,state),/artifacts differ/);await rm(join(root,'extra-executable'));
    await syntheticAcceptance(root,state); await writeFile(join(root,'dist/app.js'),'unaccepted build');
    await assert.rejects(acceptedRelease(root,state),/build differs/);
  } finally {await rm(parent,{recursive:true,force:true});}
});
