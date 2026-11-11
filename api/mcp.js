import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {makeServer} from '../lib/mcp.mjs';
import {bearer,callAgent,json,origin} from '../lib/backend.mjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.headers.origin&&req.headers.origin!==origin())return json(res,403,{error:'Origin not allowed'});
  const token=bearer(req);
  if(!token||!/^lattice_[a-f0-9]{64}$/.test(token)){res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${origin()}/.well-known/oauth-protected-resource"`);return json(res,401,{error:'Connect your Lattice account'});}
  try{await callAgent(token,'context');}catch(error){res.setHeader('WWW-Authenticate',`Bearer error="invalid_token", resource_metadata="${origin()}/.well-known/oauth-protected-resource"`);return json(res,error.code==='42501'?401:503,{error:error.code==='42501'?'Lattice connection expired or revoked':'Lattice is temporarily unavailable'});}
  if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{error:'Use POST for this stateless MCP endpoint'});}
  const server=makeServer(token),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close();server.close();});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)json(res,500,{error:'MCP request failed'});}
}
