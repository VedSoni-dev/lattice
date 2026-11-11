// Disposable fixture only. Never marks a real user's email as verified.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {database,providerRequest,readSession,webRpc,agentRpc,exchangeRpc} from '../lib/neon.mjs';
const sql=database(),email=`lattice-smoke-${randomBytes(8).toString('hex')}@example.test`;
let userId,teamId;
try{
  const signup=await providerRequest('/sign-up/email',{email,name:'Lattice disposable smoke test',password:randomBytes(32).toString('base64url')});
  userId=signup.user.id;assert.ok(signup.token);
  assert.equal(await readSession(signup.token),null);
  await assert.rejects(webRpc(signup.token,'bootstrap'),/Sign in/);
  assert.equal(signup.user.emailVerified,false);
  await sql`update neon_auth."user" set "emailVerified"=true where id=${userId} and email=${email}`;
  assert.equal((await readSession(signup.token)).user.id,userId);
  assert.equal((await webRpc(signup.token,'bootstrap')).profile.id,userId);
  teamId=(await webRpc(signup.token,'team_create',{name:'Disposable smoke team'})).id;
  const skill=await webRpc(signup.token,'skill_create',{title:'Smoke method',method:'Only a disposable test.',category:'Engineering'});
  await webRpc(signup.token,'skill_approve',{id:skill.id,team_id:teamId});
  assert.equal((await webRpc(signup.token,'bootstrap')).skills[0].status,'approved');
  const pat=await webRpc(signup.token,'connection_create',{name:'Disposable smoke connection'});
  const draft=await agentRpc(pat.token,'propose',{title:'Smoke agent method',method:'A disposable agent test.'});
  await agentRpc(pat.token,'approve',{id:draft.skill.id,approval_nonce:draft.approval_nonce,team_id:teamId});
  assert.equal((await agentRpc(pat.token,'list')).length,2);
  const verifier='a'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
  const grant=await webRpc(signup.token,'oauth_authorize',{client_id:'smoke-client',client_name:'Smoke Codex',redirect_uri:'http://127.0.0.1:12345/callback',challenge,resource:'https://lattice-team-ai.vercel.app/mcp'});
  const tokens=await exchangeRpc({grant_type:'authorization_code',code:grant.code,code_verifier:verifier,client_id:'smoke-client',redirect_uri:'http://127.0.0.1:12345/callback',resource:'https://lattice-team-ai.vercel.app/mcp'});
  assert.equal((await agentRpc(tokens.access_token,'context')).user_id,userId);
  await sql`delete from neon_auth.session where token=${signup.token}`;
  assert.equal(await readSession(signup.token),null);
  await assert.rejects(webRpc(signup.token,'bootstrap'),/Sign in/);
  console.log('PASS: provider session, unverified rejection, verified fixture, team skills, MCP approval, OAuth, and session revocation.');
}finally{
  // Only records associated with this run's generated fixture are removed.
  if(userId){await sql`delete from lattice_private.events where user_id=${userId}`;await sql`delete from lattice_private.skills where author_id=${userId}`;await sql`delete from lattice_private.invites where created_by=${userId}`;if(teamId)await sql`delete from lattice_private.teams where id=${teamId} and owner_id=${userId}`;await sql`delete from neon_auth."user" where id=${userId} and email=${email}`;console.log('Disposable fixture removed.');}
}
