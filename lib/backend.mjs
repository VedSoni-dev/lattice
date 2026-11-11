import {createClient} from '@supabase/supabase-js';
import {agentRpc,exchangeRpc,webRpc,sessionToken,readSession} from './neon.mjs';
export function publicConfig(){return process.env.NEON_AUTH_BASE_URL?{provider:'neon'}:{url:process.env.SUPABASE_URL,key:process.env.SUPABASE_ANON_KEY};}
export function backend(token){const {url,key}=publicConfig();if(!url||!key)throw new Error('Lattice account service is not configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:token?{headers:{Authorization:'Bearer '+token}}:undefined});}
export function origin(){return process.env.APP_ORIGIN||'https://lattice-team-ai.vercel.app';}
export async function callAgent(token,action,payload={}){if(process.env.NEON_AUTH_BASE_URL)return agentRpc(token,action,payload);const {data,error}=await backend().rpc('lattice_agent',{access_token:token,action,payload});if(error){const e=new Error(error.message);e.code=error.code;throw e;}return data;}
export async function callWeb(req,action,payload={}){if(process.env.NEON_AUTH_BASE_URL)return webRpc(sessionToken(req),action,payload);const {data,error}=await backend(bearer(req)).rpc('lattice_web',{action,payload});if(error)throw error;return data;}
export async function requestUser(req){if(process.env.NEON_AUTH_BASE_URL)return (await readSession(sessionToken(req)))?.user;const token=bearer(req);if(!token)return null;const {data,error}=await backend(token).auth.getUser(token);return error?null:data.user;}
export async function exchange(payload){if(process.env.NEON_AUTH_BASE_URL)return exchangeRpc(payload);const {data,error}=await backend().rpc('lattice_oauth_exchange',{payload});if(error)throw error;return data;}
export function bearer(req){const header=req.headers.authorization;return typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):null;}
export function json(res,status,body){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.statusCode=status;res.end(JSON.stringify(body));}
export function errorStatus(error){return error?.code==='42501'?401:400;}
