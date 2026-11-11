// Run only against a disposable synthetic test account, then delete that account.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const fixture=JSON.parse(await readFile('.env.smoke.json','utf8'));
const base='https://lattice-team-ai.vercel.app';
const client=new Client({name:'lattice-deployment-smoke-test',version:'1.0.0'});
try {
  const challenge=await fetch(base+'/mcp');
  assert.equal(challenge.status,401);
  assert.match(challenge.headers.get('www-authenticate'),/resource_metadata/);
  const registration=await fetch(base+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Lattice smoke test',redirect_uris:['http://127.0.0.1:45678/callback'],token_endpoint_auth_method:'none'})});
  assert.equal(registration.status,201);
  assert.ok((await registration.json()).client_id);
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+fixture.token}}}));
  const {tools}=await client.listTools();assert.equal(tools.length,5);
  const account=await client.callTool({name:'account_context',arguments:{}});
  assert.equal(account.structuredContent.user_id,fixture.id);
  const draft=await client.callTool({name:'propose_skill',arguments:{title:'Temporary deployment test',description:'Synthetic test method.',method:'Verify the primary action before adding visual polish.',category:'Design'}});
  assert.ok(!draft.isError);assert.equal(draft.structuredContent.skill.status,'draft');
  assert.ok(draft._meta.approval_nonce);assert.ok(!JSON.stringify(draft.structuredContent).includes(draft._meta.approval_nonce));
  const hidden=await client.callTool({name:'search_skills',arguments:{}});assert.equal(hidden.structuredContent.skills.length,0);
  const card=await client.readResource({uri:'ui://lattice/approve-skill.html'});assert.match(card.contents[0].text,/html/);
  const approved=await client.callTool({name:'approve_skill',arguments:{id:draft.structuredContent.skill.id,approval_nonce:draft._meta.approval_nonce}});
  assert.ok(!approved.isError);assert.equal(approved.structuredContent.skill.status,'approved');
  const borrowed=await client.callTool({name:'borrow_skill',arguments:{id:draft.structuredContent.skill.id}});assert.ok(!borrowed.isError);
  const replay=await client.callTool({name:'approve_skill',arguments:{id:draft.structuredContent.skill.id,approval_nonce:draft._meta.approval_nonce}});assert.equal(replay.isError,true);
  console.log('Live MCP: OAuth discovery/registration, authenticated SDK handshake, capture, private drafts, packaged approval card, approval, borrow, and replay rejection passed.');
}finally{await client.close();}
