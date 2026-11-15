import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { uninstall } from './uninstall-core.mjs';
const args=process.argv.slice(2);
if(args.length!==1||args[0]!=='--confirm'){
  console.error('Usage: node scripts/uninstall.mjs --confirm\nRemoves managed commands and skills; archives installation; preserves private state, credentials and VM disk.');process.exit(2);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {assertHostQuiescent}=await import(pathToFileURL(join(root,'dist/src/application/operator.js')).href);
const {reserveHost}=await import(pathToFileURL(join(root,'dist/src/adapters/host-activity.js')).href);
const release=await reserveHost(join(homedir(),'.local/state/aegean'),'transition','uninstall');
try{console.log(JSON.stringify(await uninstall(homedir(),assertHostQuiescent),null,2));}
finally{await release();}
