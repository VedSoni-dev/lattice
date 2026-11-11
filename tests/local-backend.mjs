// LOCAL UI TEST FIXTURE ONLY. Not deployed. Uses throwaway accounts and PGlite.
import http from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
const db=new PGlite(),accounts=new Map(),sessions=new Map();
await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$select sha256(convert_to(value,'UTF8'))$$;
create function extensions.gen_random_bytes(size integer) returns bytea language sql volatile as $$select decode(string_agg(md5(random()::text),''),'hex') from generate_series(1,size/16)$$;`);
await db.exec((await readFile('db/001_lattice.sql','utf8')).replace('create extension if not exists pgcrypto with schema extensions;',''));
function publicUser(account){return {id:account.id,email:account.email,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),user_metadata:{name:account.name},app_metadata:{provider:'email',providers:['email']}};}
function session(account){const expires=Math.floor(Date.now()/1000)+3600;const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:account.id,exp:expires,iat:expires-3600,role:'authenticated'})).toString('base64url')+'.'+randomBytes(32).toString('base64url');sessions.set(token,account);return {access_token:token,refresh_token:randomBytes(32).toString('hex'),token_type:'bearer',expires_in:3600,expires_at:expires,user:publicUser(account)};}
let queue=Promise.resolve();
async function handle(req,res){console.log(req.method,req.url,req.headers['access-control-request-headers']||'');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4174');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,content-profile,accept-profile,prefer,x-client-info,x-supabase-api-version,x-supabase-client-platform,x-supabase-client-platform-version,x-supabase-client-runtime,x-supabase-client-runtime-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');res.setHeader('Content-Type','application/json');if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
const send=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
try{const url=new URL(req.url,'http://127.0.0.1:4175'),parts=[];for await(const part of req)parts.push(part);const raw=Buffer.concat(parts).toString(),body=raw?JSON.parse(raw):{};const account=sessions.get(req.headers.authorization?.slice(7));
if(url.pathname==='/auth/v1/signup'){if(!body.email?.endsWith('.test'))return send(400,{msg:'Use a .test address in this local fixture'});if(accounts.has(body.email))return send(400,{msg:'Account exists'});const salt=randomBytes(16);const user={id:randomUUID(),email:body.email,name:body.data?.name||'Test User',salt,hash:scryptSync(body.password,salt,32)};accounts.set(user.email,user);await db.query('insert into auth.users values($1,$2,now(),$3)',[user.id,user.email,{name:user.name}]);return send(200,session(user));}
if(url.pathname==='/auth/v1/token'){const user=accounts.get(body.email);if(!user||!timingSafeEqual(user.hash,scryptSync(body.password||'',user.salt,32)))return send(400,{error:'invalid_grant',error_description:'Invalid login credentials'});return send(200,session(user));}
if(url.pathname==='/auth/v1/user'){if(!account)return send(401,{msg:'Invalid token'});return send(200,publicUser(account));}
if(url.pathname==='/auth/v1/logout'){sessions.delete(req.headers.authorization?.slice(7));res.statusCode=204;res.end();return;}
if(url.pathname==='/rest/v1/rpc/lattice_web'){if(!account)return send(401,{message:'Sign in to continue'});await db.query("select set_config('request.jwt.claim.sub',$1,false)",[account.id]);await db.exec('set role authenticated');try{const {rows}=await db.query('select public.lattice_web($1,$2) as result',[body.action,body.payload]);return send(200,rows[0].result);}finally{await db.exec('reset role');}}
if(url.pathname==='/rest/v1/rpc/lattice_agent'){const {rows}=await db.query('select public.lattice_agent($1,$2,$3) as result',[body.access_token,body.action,body.payload]);return send(200,rows[0].result);}
return send(404,{message:'Local fixture endpoint not implemented'});
}catch(error){send(400,{message:error.message,code:error.code});}}
http.createServer((req,res)=>{queue=queue.then(()=>handle(req,res)).catch(()=>{res.statusCode=500;res.end();});}).listen(4175,'127.0.0.1',()=>console.log('Throwaway UI test backend on 127.0.0.1:4175; .test accounts only.'));
