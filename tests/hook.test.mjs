import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('optional Codex hook stores no content and only nudges once after edits',async()=>{
 const home=await mkdtemp(join(tmpdir(),'lattice-hook-test-'));
 const run=payload=>{const result=spawnSync(process.execPath,['codex-setup/capture-hook.mjs'],{input:JSON.stringify(payload),encoding:'utf8',env:{...process.env,CODEX_HOME:home}});assert.equal(result.status,0);return JSON.parse(result.stdout);};
 try{
  assert.deepEqual(run({hook_event_name:'Stop',session_id:'s',turn_id:'t'}),{});
  run({hook_event_name:'PostToolUse',session_id:'s',turn_id:'t',tool_input:{secret:'never-store-this'},tool_response:'private code',transcript_path:'do-not-read'});
  const names=await readdir(join(home,'lattice','markers'));assert.equal(names.length,1);const stored=await readFile(join(home,'lattice','markers',names[0]),'utf8');assert.equal(stored.includes('private'),false);assert.equal(stored.includes('secret'),false);
  assert.equal(run({hook_event_name:'Stop',session_id:'s',turn_id:'t'}).decision,'block');assert.deepEqual(run({hook_event_name:'Stop',session_id:'s',turn_id:'t'}),{});
  run({hook_event_name:'PostToolUse',session_id:'s',turn_id:'t2'});assert.deepEqual(run({hook_event_name:'Stop',session_id:'s',turn_id:'t2',stop_hook_active:true}),{});
 }finally{await rm(home,{recursive:true,force:true});}
});
