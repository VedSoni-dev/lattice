import {neon} from '@neondatabase/serverless';
import {createHash} from 'node:crypto';

let connection;
export function database(){return connection??=neon(process.env.DATABASE_URL);}
export const cookieName='__Host-lattice_session';
export function sessionToken(req){
  const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!value)return null;
  try{const token=decodeURIComponent(value);return /^[A-Za-z0-9._~-]{20,512}$/.test(token)?token:null;}catch{return null;}
}
export function setSessionCookie(res,token,maxAge=604800){res.setHeader('Set-Cookie',`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);}
export async function readSession(token){
  if(!token)return null;
  const rows=await database()`select u.id,u.email,u.name,s."expiresAt" as expires_at
    from neon_auth.session s join neon_auth."user" u on u.id=s."userId"
    where s.token=${token} and s."expiresAt">now() and u."emailVerified"=true
    and (u.banned is not true or u."banExpires"<=now())`;
  if(!rows.length)return null;
  const {expires_at,...user}=rows[0];return {user,expires_at};
}
export async function webRpc(token,action,payload={}){
  if(!token)throw Object.assign(new Error('Sign in to continue'),{code:'42501'});
  const sql=database();
  // Bind the identity from the live provider session inside this transaction.
  // Neither the browser nor a supplied payload can choose a user ID.
  const result=await sql.transaction([
    sql`select set_config('request.jwt.claim.sub',coalesce((select s."userId"::text from neon_auth.session s join neon_auth."user" u on u.id=s."userId" where s.token=${token} and s."expiresAt">now() and u."emailVerified"=true and (u.banned is not true or u."banExpires"<=now())),''),true)`,
    sql`select public.lattice_web(${action},${JSON.stringify(payload)}::jsonb) as result`
  ]);
  return result[1][0].result;
}
export async function agentRpc(token,action,payload={}){return (await database()`select public.lattice_agent(${token},${action},${JSON.stringify(payload)}::jsonb) as result`)[0].result;}
export async function exchangeRpc(payload){return (await database()`select public.lattice_oauth_exchange(${JSON.stringify(payload)}::jsonb) as result`)[0].result;}
export async function rateLimit(req,email,action){
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
  const interval=15*60*1000,bucket=Math.floor(Date.now()/interval);
  const sql=database();
  for(const [kind,value,limit] of [['ip',ip,action==='send'?20:50],['email',email,action==='send'?5:15]]){
    const key=createHash('sha256').update(`${action}:${kind}:${value}:${bucket}`).digest('hex');
    const rows=await sql`insert into lattice_private.auth_limits(key,expires_at) values(${key},now()+interval '30 minutes') on conflict(key) do update set attempts=lattice_private.auth_limits.attempts+1 returning attempts`;
    if(rows[0].attempts>limit)throw Object.assign(new Error('Too many attempts. Please wait 15 minutes and try again.'),{status:429});
  }
  await sql`delete from lattice_private.auth_limits where expires_at<now()`;
}
export async function providerRequest(path,payload){
  if(path.startsWith('/sign-in/')||path.startsWith('/sign-up/'))payload={...payload,callbackURL:(process.env.APP_ORIGIN||'https://lattice-team-ai.vercel.app')+'/app'};
  const response=await fetch(process.env.NEON_AUTH_BASE_URL+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:process.env.APP_ORIGIN||'https://lattice-team-ai.vercel.app'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),redirect:'error'});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.message||'Unable to sign in. Please try again.'),{status:response.status});
  return data;
}
