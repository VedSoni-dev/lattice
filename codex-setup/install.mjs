import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';

const endpoint=new URL('/mcp',process.env.LATTICE_URL||'https://lattice-team-ai.vercel.app').href;
const codexDir=resolve(process.env.CODEX_HOME||join(homedir(),'.codex'));
const configPath=join(codexDir,'config.toml');
await mkdir(codexDir,{recursive:true});
let config='';try{config=await readFile(configPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(/^\s*\[mcp_servers\.lattice\]/m.test(config)){
  console.log('A Lattice server is already configured. Existing settings were preserved.');
}else{
  if(config)await copyFile(configPath,configPath+'.lattice-backup-'+Date.now());
  await writeFile(configPath,config+'\n# Lattice: shared methods for your team\n[mcp_servers.lattice]\nurl = "'+endpoint+'"\n');
  console.log('Added Lattice to '+configPath);
}
if(process.argv.includes('--hooks')){
  const source=dirname(fileURLToPath(import.meta.url)),target=join(codexDir,'lattice');await mkdir(target,{recursive:true});await copyFile(join(source,'capture-hook.mjs'),join(target,'capture-hook.mjs'));
  const hooksPath=join(codexDir,'hooks.json');let hooks={hooks:{}};
  try{hooks=JSON.parse(await readFile(hooksPath,'utf8'));await copyFile(hooksPath,hooksPath+'.lattice-backup-'+Date.now());}catch(error){if(error.code!=='ENOENT')throw error;}
  hooks.hooks||={};const command='"'+process.execPath+'" "'+join(target,'capture-hook.mjs')+'"';
  for(const event of ['PostToolUse','Stop']){
    hooks.hooks[event]||=[];
    if(!hooks.hooks[event].some(group=>group.hooks?.some(h=>h.command===command)))hooks.hooks[event].push({...event==='PostToolUse'?{matcher:'apply_patch|Edit|Write'}:{},hooks:[{type:'command',command,timeout:3}]});
  }
  await writeFile(hooksPath,JSON.stringify(hooks,null,2)+'\n');
  console.log('Added optional local capture reminders. Review and trust them with /hooks in Codex.');
}
console.log('\nNext: restart Codex, then select Authenticate for Lattice in Settings → MCP servers.\nOr run: codex mcp login lattice\n\nThe installer does not read your projects or transcripts, and does not create an account.');
