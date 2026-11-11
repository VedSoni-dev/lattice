import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('real PostgreSQL authorization, invitations, sharing, and OAuth lifecycle',async t=>{
  const db=new PGlite();
  // Test-only replacements for pgcrypto, which is unavailable in the WASM build.
  // The production migration uses the real pgcrypto extension.
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$select sha256(convert_to(value,'UTF8'))$$;
    create function extensions.gen_random_bytes(size integer) returns bytea language sql volatile as $$select decode(string_agg(md5(random()::text),''),'hex') from generate_series(1,size/16)$$;
  `);
  const migration=(await readFile('db/001_lattice.sql','utf8')).replace('create extension if not exists pgcrypto with schema extensions;','');
  await db.exec(migration);
  await db.exec(await readFile('db/002_skill_trees.sql','utf8'));
  const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002',eve='00000000-0000-4000-8000-000000000003';
  for(const [id,name] of [[alice,'Alice'],[bob,'Bob'],[eve,'Eve']])await db.query("insert into auth.users values($1,$2,now(),$3)",[id,name.toLowerCase()+'@example.test',JSON.stringify({name})]);
  async function web(user,action,payload={}){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec('set role authenticated');try{return (await db.query('select public.lattice_web($1,$2) as result',[action,payload])).rows[0].result;}finally{await db.exec('reset role');}}
  async function agent(token,action,payload={}){await db.exec('set role anon');try{return (await db.query('select public.lattice_agent($1,$2,$3) as result',[token,action,payload])).rows[0].result;}finally{await db.exec('reset role');}}
  async function exchange(payload){await db.exec('set role anon');try{return (await db.query('select public.lattice_oauth_exchange($1) as result',[payload])).rows[0].result;}finally{await db.exec('reset role');}}
  for(const user of [alice,bob,eve])await web(user,'bootstrap');
  let team,skill,aliceToken,bobToken;
  await t.test('unauthenticated users and direct table reads are denied',async()=>{await assert.rejects(web(null,'bootstrap'),/Sign in/);await db.exec('set role authenticated');await assert.rejects(db.query('select * from lattice_private.skills'),/permission denied/);await db.exec('reset role');});
  await t.test('owner creates team; outsiders cannot inspect or invite',async()=>{team=(await web(alice,'team_create',{name:'Design team'})).id;await assert.rejects(web(eve,'team_details',{id:team}),/Team not found/);await assert.rejects(web(eve,'invite_create',{team_id:team}),/Only the team owner/);});
  await t.test('email restricted invites are one-use and assign member role',async()=>{const invite=await web(alice,'invite_create',{team_id:team,email:'bob@example.test'});await assert.rejects(web(eve,'invite_accept',{token:invite.token}),/email address/);await web(bob,'invite_accept',{token:invite.token});await web(bob,'invite_accept',{token:invite.token});const data=await web(bob,'bootstrap');assert.equal(data.teams[0].role,'member');assert.equal((await web(alice,'team_details',{id:team})).members.length,2);await assert.rejects(web(eve,'invite_accept',{token:invite.token}),/already been used/);});
  await t.test('revoked and expired invites cannot be accepted',async()=>{const invite=await web(alice,'invite_create',{team_id:team});await web(alice,'invite_revoke',{id:invite.id});await assert.rejects(web(eve,'invite_accept',{token:invite.token}),/expired/);const expired=await web(alice,'invite_create',{team_id:team});await db.query("update lattice_private.invites set expires_at=now()-interval '1 day' where id=$1",[expired.id]);await assert.rejects(web(eve,'invite_accept',{token:expired.token}),/expired/);});
  await t.test('drafts remain private until author approval; sharing never crosses teams',async()=>{skill=await web(alice,'skill_create',{title:'Clear hierarchy',method:'Start with the primary action.',category:'Design'});assert.equal(skill.status,'draft');assert.equal((await web(bob,'bootstrap')).skills.length,0);await assert.rejects(web(bob,'skill_approve',{id:skill.id,team_id:team}),/Only the author/);await assert.rejects(web(alice,'skill_share',{id:skill.id,team_id:team}),/Approve the method/);await web(alice,'skill_approve',{id:skill.id,team_id:team});assert.equal((await web(bob,'bootstrap')).skills[0].id,skill.id);assert.equal((await web(eve,'bootstrap')).skills.length,0);});
  await t.test('editing resets team-visible approval',async()=>{await web(alice,'skill_update',{id:skill.id,title:skill.title,method:'Start with the primary action. Use the design system.',category:'Design'});assert.equal((await web(bob,'bootstrap')).skills.length,0);await web(alice,'skill_approve',{id:skill.id,team_id:team});});
  await t.test('MCP approval requires a valid one-time nonce, including null rejection',async()=>{aliceToken=(await web(alice,'connection_create',{name:'Codex PAT'})).token;bobToken=(await web(bob,'connection_create',{name:'Codex PAT'})).token;const draft=await agent(aliceToken,'propose',{title:'New method',method:'Do the work this way.',category:'Engineering'});await assert.rejects(agent(aliceToken,'approve',{id:draft.skill.id}),/Approval expired/);await assert.rejects(agent(bobToken,'approve',{id:draft.skill.id,approval_nonce:draft.approval_nonce}),/Approval expired/);const approved=await agent(aliceToken,'approve',{id:draft.skill.id,approval_nonce:draft.approval_nonce,team_id:team});assert.equal(approved.status,'approved');await assert.rejects(agent(aliceToken,'approve',{id:draft.skill.id,approval_nonce:draft.approval_nonce}),/Approval expired/);});
  await t.test('versioned trees keep methods separate, freeze dependencies, and enforce access',async()=>{
    const child=await web(alice,'skill_create',{title:'Choose typography',description:'Choose readable type',method:'Original method'});
    await web(alice,'skill_approve',{id:child.id});
    const definition={schema_version:1,use_when:'Build a page',outcome:'A legible page',inputs:['Brief'],checks:['Readable on mobile'],capabilities:['edit design'],dependencies:[{id:child.id,version:1,required:true,when:'Set type'}]};
    const parent=await web(alice,'skill_create',{title:'Build a frontend',method:'Use the child method',definition});
    await assert.rejects(web(alice,'skill_approve',{id:parent.id,team_id:team}),/Share every child/);
    await web(alice,'skill_share',{id:child.id,team_id:team});
    await web(alice,'skill_approve',{id:parent.id,team_id:team});
    const outline=await agent(bobToken,'inspect',{id:parent.id});
    assert.equal(outline.method,undefined);assert.equal(outline.children[0].method,undefined);assert.equal(outline.children[0].title,child.title);
    const loaded=await agent(bobToken,'borrow',{id:parent.id});assert.equal(loaded.method,'Use the child method');assert.equal(loaded.children[0].method,undefined);
    await web(alice,'skill_update',{id:child.id,title:child.title,method:'New method'});
    assert.equal((await agent(bobToken,'inspect',{id:parent.id})).children[0].available,false);
    await web(alice,'skill_approve',{id:child.id,team_id:team});
    const pinned=await agent(bobToken,'borrow',{id:child.id,version:1,parent_id:parent.id,parent_version:1});assert.equal(pinned.method,'Original method');assert.equal(pinned.current_version,2);
    await assert.rejects(agent(bobToken,'borrow',{id:child.id,version:2,parent_id:parent.id,parent_version:1}),/not a child/);
    const usage=await web(bob,'skill_usage',{id:parent.id});assert.equal(usage[0].skill_version,1);assert.equal(usage[0].parent_skill_id,parent.id);
    await assert.rejects(web(alice,'skill_update',{id:child.id,title:child.title,method:'Cycle',definition:{dependencies:[{id:parent.id,version:1,required:true}]}}),/depend on itself/);
    await assert.rejects(web(eve,'skill_create',{title:'Steal private tree',method:'Read it',definition}),/unavailable/);
    await assert.rejects(web(alice,'skill_create',{title:'Missing version',method:'Read it',definition:{dependencies:[{id:child.id,version:99,required:false}]}}),/not approved/);
    await web(alice,'skill_share',{id:child.id,team_id:''});
    const redacted=await agent(bobToken,'inspect',{id:parent.id});assert.equal(redacted.children[0].available,false);assert.equal(redacted.children[0].title,'Unavailable child skill');
    await assert.rejects(agent(bobToken,'borrow',{id:child.id,version:1}),/not available/);
    await web(alice,'skill_archive',{id:parent.id});await assert.rejects(agent(aliceToken,'borrow',{id:parent.id,version:1}),/not available/);
  });
  await t.test('removing a teammate immediately removes MCP access to team skills',async()=>{assert.ok((await agent(bobToken,'list')).length>0);await assert.rejects(web(bob,'member_remove',{team_id:team,user_id:alice}),/Not allowed/);await web(alice,'member_remove',{team_id:team,user_id:bob});assert.equal((await agent(bobToken,'list')).length,0);await assert.rejects(agent(bobToken,'borrow',{id:skill.id}),/not available/);await assert.rejects(web(alice,'team_leave',{team_id:team}),/owner cannot/);});
  await t.test('PKCE, audience, redirect URI, null fields, and replay are enforced',async()=>{const verifier='a'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url'),resource='https://lattice.test/mcp';const grant=await web(alice,'oauth_authorize',{client_id:'client-1',client_name:'Codex',redirect_uri:'http://127.0.0.1:12345/callback',challenge,resource});const payload={grant_type:'authorization_code',code:grant.code,client_id:'client-1',redirect_uri:'http://127.0.0.1:12345/callback',resource,code_verifier:verifier};await assert.rejects(exchange({...payload,code_verifier:'b'.repeat(64)}),/Invalid code verifier/);await assert.rejects(exchange({...payload,client_id:null}),/Invalid authorization grant/);await assert.rejects(exchange({...payload,resource:null}),/Invalid authorization grant/);await assert.rejects(exchange({...payload,redirect_uri:'https://evil.test'}),/Invalid authorization grant/);const tokens=await exchange(payload);assert.equal((await agent(tokens.access_token,'context')).user_id,alice);await assert.rejects(exchange(payload),/Invalid authorization grant/);const refreshed=await exchange({grant_type:'refresh_token',client_id:'client-1',refresh_token:tokens.refresh_token});await assert.rejects(agent(tokens.access_token,'context'),/expired/);assert.ok((await agent(refreshed.access_token,'context')).user_id);await assert.rejects(exchange({grant_type:'refresh_token',client_id:'client-1',refresh_token:tokens.refresh_token}),/Invalid refresh/);});
  await t.test('revoked connections cannot read or propose',async()=>{const data=await web(alice,'bootstrap');const c=data.connections.find(c=>c.name==='Codex PAT');await web(alice,'connection_revoke',{id:c.id});await assert.rejects(agent(aliceToken,'context'),/expired/);});
  await db.close();
});
