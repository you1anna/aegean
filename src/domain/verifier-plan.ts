/** Toolchain owns these values; entry points share argument construction. */
export function verifierStartArgs(v:{profile:string;cpus:number;memoryGiB:number;diskGiB:number;candidateRoot:string}):string[]{
  return ['start','--profile',v.profile,'--activate=false','--cpus',String(v.cpus),'--memory',String(v.memoryGiB),'--disk',String(v.diskGiB),'--mount-type','virtiofs','--mount',v.candidateRoot];
}

export function verifierProfileState(output:string,profile:string):'Running'|'Stopped'{
  const entries=output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as {name?:string;status?:string});
  const matches=entries.filter(entry=>entry.name===profile);
  if(matches.length!==1||!['Running','Stopped'].includes(matches[0]!.status??''))throw new Error('verifier state is absent or unknown; inspect aegean verifier status');
  return matches[0]!.status as 'Running'|'Stopped';
}
