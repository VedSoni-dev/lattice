import {json,origin,errorStatus} from '../lib/backend.mjs';
import {sessionToken,webRpc} from '../lib/neon.mjs';
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==origin())return json(res,403,{error:'Open this request from Lattice.'});
  try{const input=typeof req.body==='string'?JSON.parse(req.body):req.body||{};if(typeof input.action!=='string'||!input.payload||Array.isArray(input.payload)||typeof input.payload!=='object')return json(res,400,{error:'Invalid request'});return json(res,200,{data:await webRpc(sessionToken(req),input.action,input.payload)});}catch(error){return json(res,errorStatus(error),{error:error.message});}
}
