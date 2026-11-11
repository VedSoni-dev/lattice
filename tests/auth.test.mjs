import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../api/auth.js';
import workspace from '../api/workspace.js';
import {sessionToken,setSessionCookie,cookieName} from '../lib/neon.mjs';

function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};}
test('session cookies are host-only, HttpOnly, Secure and reject malformed values',()=>{
  assert.equal(sessionToken({headers:{cookie:`${cookieName}=%ZZ`}}),null);
  assert.equal(sessionToken({headers:{cookie:`${cookieName}=short`}}),null);
  assert.equal(sessionToken({headers:{cookie:`${cookieName}=${'x'.repeat(600)}`}}),null);
  assert.equal(sessionToken({headers:{cookie:`unrelated=hello; ${cookieName}=${'x'.repeat(40)}`}}),'x'.repeat(40));
  const res=response();setSessionCookie(res,'x'.repeat(40));assert.match(res.headers['Set-Cookie'],/Path=\/; HttpOnly; Secure; SameSite=Lax/);assert.doesNotMatch(res.headers['Set-Cookie'],/Domain=/);
});
test('cross-origin login, logout and workspace mutations are rejected before provider/database access',async()=>{
  process.env.NEON_AUTH_BASE_URL='https://auth.example.test/auth';process.env.APP_ORIGIN='https://lattice.example.test';
  for(const [handler,action] of [[auth,'send'],[auth,'verify'],[auth,'logout'],[workspace,null]]){
    const res=response();await handler({method:'POST',headers:{origin:'https://evil.example.test'},query:{action},body:{email:'a@example.test',code:'123456',action:'bootstrap',payload:{}}},res);assert.equal(res.statusCode,403);
  }
  const res=response();await workspace({method:'POST',headers:{origin:process.env.APP_ORIGIN},body:{action:'bootstrap',payload:{}}},res);assert.equal(res.statusCode,401);
});
test('public session response and auth validation need no database for signed-out visitors',async()=>{
  const res=response();await auth({method:'GET',headers:{},query:{action:'session'}},res);assert.deepEqual(res.body,{session:null});assert.equal(res.headers['Cache-Control'],'no-store');
  const invalid=response();await auth({method:'POST',headers:{origin:process.env.APP_ORIGIN},query:{action:'verify'},body:{email:'a@example.test',code:'not-a-code'}},invalid);assert.equal(invalid.statusCode,400);
});
