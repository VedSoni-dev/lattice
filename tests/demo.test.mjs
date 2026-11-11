import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoStore} from '../src/demo-store.js';
function memory(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
test('demo drafts, approval, edits and reset survive browser-store reloads',async()=>{
  const storage=memory();let demo=createDemoStore(storage);
  const draft=await demo.rpc('skill_create',{title:'A reusable method',method:'Check keyboard navigation.'});
  assert.equal(draft.status,'draft');assert.equal(draft.team_id,null);
  await assert.rejects(demo.rpc('skill_borrow',{id:draft.id}));
  await demo.rpc('skill_approve',{id:draft.id,team_id:demo.defaultTeam});
  demo=createDemoStore(storage);
  assert.equal((await demo.rpc('skill_borrow',{id:draft.id})).team_id,demo.defaultTeam);
  await demo.rpc('skill_update',{id:draft.id,title:draft.title,method:'Also verify focus order.'});
  await assert.rejects(demo.rpc('skill_borrow',{id:draft.id}));
  assert.equal((await demo.rpc('bootstrap')).skills.find(s=>s.id===draft.id).team_id,null);
  await assert.rejects(demo.rpc('skill_archive',{id:'demo-design'}));
  demo.reset();assert.equal((await createDemoStore(storage).rpc('bootstrap')).skills.length,7);
});
test('demo invitation joining is local, single-use, and revocable',async()=>{
  const storage=memory(),demo=createDemoStore(storage),otherBrowser=createDemoStore(memory());
  const invite=await demo.rpc('invite_create',{team_id:demo.defaultTeam});
  await assert.rejects(otherBrowser.rpc('invite_preview',{token:invite.token}));
  await demo.rpc('invite_accept',{token:invite.token,name:'Jordan'});
  assert.equal((await createDemoStore(storage).rpc('team_details',{id:demo.defaultTeam})).members.length,4);
  await assert.rejects(demo.rpc('invite_accept',{token:invite.token}));
  const revoked=await demo.rpc('invite_create',{team_id:demo.defaultTeam});
  await demo.rpc('invite_revoke',{id:revoked.id});
  await assert.rejects(demo.rpc('invite_accept',{token:revoked.token}));
  await assert.rejects(demo.rpc('connection_create',{name:'No real credentials'}));
});

