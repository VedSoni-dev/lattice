import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// This optional hook keeps only an edit marker. It never reads or uploads the transcript,
// tool arguments, output, source files, or credentials.
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2000000){console.log('{}');process.exit(0);}}
try{
  const input=JSON.parse(raw),directory=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'lattice','markers');
  const key=createHash('sha256').update(String(input.session_id||'')+':'+String(input.turn_id||'')).digest('hex');
  const marker=join(directory,key+'.json');
  if(input.hook_event_name==='PostToolUse'){
    await mkdir(directory,{recursive:true});await writeFile(marker,JSON.stringify({at:Date.now()}));console.log('{}');
  }else if(input.hook_event_name==='Stop'){
    let edit;try{edit=JSON.parse(await readFile(marker,'utf8'));await unlink(marker);}catch{}
    if(input.stop_hook_active||!edit||Date.now()-edit.at>3600000){console.log('{}');}
    else console.log(JSON.stringify({decision:'block',reason:'Lattice capture check: this turn included file edits. If the completed work contains a reusable method worth sharing, briefly ask whether this is the ideal way and offer to capture it with Lattice. If the user already requested capture, use propose_skill and show its approval card or review link. Otherwise do not upload or save a draft until they agree. Skip this if no useful reusable method emerged or capture was already discussed. Never approve or share a method for the user. Do not repeat this reminder.'}));
  }else console.log('{}');
}catch{console.log('{}');}
