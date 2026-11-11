import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {makeServer} from '../lib/mcp.mjs';
import {installPrompt} from '../lib/install-prompt.mjs';
import {formatSkill} from '../lib/skill-format.mjs';
import {createDemoStore} from '../src/demo-store.js';
const parentId='00000000-0000-4000-8000-000000000011',childId='00000000-0000-4000-8000-000000000012';
for(const host of ['Codex','Claude Code','Cursor'])test(`${host} negotiates discovery, inspection, pinned loading, and private composition`,async()=>{
 const calls=[];
 const parent={id:parentId,title:'Build a page',description:'Frontend workflow',method:'Parent method',version:2,author_name:'Maya',status:'approved',definition:{use_when:'New pages',outcome:'Usable page',checks:['Main journey works'],dependencies:[{id:childId,version:1,required:true,when:'Before handoff'}]},children:[{id:childId,version:1,title:'Check keyboard input',required:true,available:true}]};
 const server=makeServer('synthetic',async(token,action,payload)=>{calls.push({action,payload});if(action==='context')return {teams:[]};if(action==='list')return [parent];if(action==='inspect'){const {method,...outline}=parent;return outline;}if(action==='propose')return {skill:{...parent,status:'draft',definition:payload.definition},approval_nonce:'a'.repeat(64)};return parent;});
 const client=new Client({name:host,version:'protocol-test'}),[a,b]=InMemoryTransport.createLinkedPair();
 await Promise.all([server.connect(a),client.connect(b)]);
 try{
  const search=await client.callTool({name:'search_skills',arguments:{query:'page'}});
  assert.equal(search.structuredContent.skills[0].child_count,1);assert.equal(search.structuredContent.skills[0].method,undefined);assert.equal(search.structuredContent.skills[0].definition,undefined);
  const inspect=await client.callTool({name:'inspect_skill',arguments:{id:parentId,version:2}});assert.equal(inspect.structuredContent.skill.method,undefined);
  const load=await client.callTool({name:'borrow_skill',arguments:{id:childId,version:1,parent_id:parentId,parent_version:2}});assert.equal(calls.at(-1).payload.version,1);assert.equal(calls.at(-1).payload.parent_id,parentId);assert.match(load.content[0].text,/Child skills/);
  const proposed=await client.callTool({name:'propose_skill',arguments:{title:'Build a page',description:'A composed skill',method:'Follow the steps',definition:parent.definition}});
  assert.equal(proposed.structuredContent.skill.status,'draft');assert.equal(proposed.structuredContent.skill.definition.dependencies[0].version,1);assert.match(proposed.structuredContent.review_url,/\/app\?skill=/);assert.equal(calls.some(c=>c.action==='approve'),false);
 }finally{await client.close();await server.close();}
});
test('portable export keeps exact child references and non-coding capability needs',()=>{
 const doc=formatSkill({id:parentId,title:'Design a slide',version:3,author_name:'Alex',method:'Set a clear hierarchy',definition:{capabilities:['Edit a presentation'],checks:['Headline remains readable']},children:[{id:childId,version:2,title:'Typography',required:true,available:false}]});
 assert.match(doc,/Edit a presentation/);assert.match(doc,/version: 2/);assert.match(doc,/unavailable/);assert.match(doc,/parent_version=3/);
});
test('install prompt routes per client and preserves authorization boundaries',()=>{
 for(const host of ['codex','claude','cursor']){const prompt=installPrompt(host);assert.match(prompt,/Preserve existing configuration/);assert.match(prompt,/do not duplicate/);assert.match(prompt,/account_context/);assert.match(prompt,/never approve or share/i);}
 assert.match(installPrompt('claude'),/--transport http --scope user/);assert.match(installPrompt('cursor'),/~\/.cursor\/mcp.json/);assert.match(installPrompt('cursor'),/alwaysApply: true/);assert.match(installPrompt('auto'),/cannot install a connector/);
});
test('demo skill tree loads one node at a time and records versions',async()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const demo=createDemoStore(storage);const tree=await demo.rpc('skill_inspect',{id:'demo-design'});
 assert.equal(tree.children.length,3);assert.equal(tree.children[0].method,undefined);assert.equal(tree.children[1].required,false);
 const child=await demo.rpc('skill_inspect',{id:tree.children[0].id,version:1});assert.ok(child.method);
 await demo.rpc('skill_borrow',{id:tree.id,version:1});assert.equal((await demo.rpc('skill_usage',{id:tree.id}))[0].skill_version,1);
 demo.reset();assert.equal((await demo.rpc('skill_inspect',{id:'demo-design'})).children.length,3);
});
