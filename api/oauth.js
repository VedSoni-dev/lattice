import {callWeb,requestUser,exchange,json,origin} from '../lib/backend.mjs';
import {registerClient,readClient,validateAuthorization,SCOPES} from '../lib/oauth.mjs';
export default async function handler(req,res){
  const base=origin(),resource=base+'/mcp',action=req.query?.action;
  try{
    if(action==='resource'&&req.method==='GET')return json(res,200,{resource,authorization_servers:[base],scopes_supported:SCOPES.split(' '),bearer_methods_supported:['header'],resource_name:'Lattice team skills'});
    if(action==='metadata'&&req.method==='GET')return json(res,200,{issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/oauth/token',registration_endpoint:base+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:SCOPES.split(' ')});
    if(action==='register'&&req.method==='POST'){const input=typeof req.body==='string'?JSON.parse(req.body):req.body;return json(res,201,registerClient(input));}
    if(action==='inspect'&&req.method==='GET'){const client=validateAuthorization(req.query,resource);return json(res,200,{client_name:client.name,scopes:SCOPES.split(' ')});}
    if(action==='authorize'&&req.method==='POST'){
      if(req.headers.origin!==base)return json(res,403,{error:'invalid_request',error_description:'Open this request from the Lattice account page.'});
      const input=typeof req.body==='string'?JSON.parse(req.body):req.body;const client=validateAuthorization(input,resource);if(!await requestUser(req))return json(res,401,{error:'login_required'});
      const data=await callWeb(req,'oauth_authorize',{client_id:input.client_id,client_name:client.name,redirect_uri:input.redirect_uri,challenge:input.code_challenge,resource});
      const redirect=new URL(input.redirect_uri);redirect.searchParams.set('code',data.code);if(input.state)redirect.searchParams.set('state',input.state);
      return json(res,200,{redirect:redirect.toString()});
    }
    if(action==='token'&&req.method==='POST'){
      const input=typeof req.body==='string'?Object.fromEntries(new URLSearchParams(req.body)):req.body;
      readClient(input?.client_id);if(input.resource!==resource)throw new Error('Invalid resource');
      if(!['authorization_code','refresh_token'].includes(input.grant_type))throw new Error('Unsupported grant');
      if(input.grant_type==='authorization_code'&&(!/^[a-f0-9]{64}$/.test(input.code||'')||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier||'')))throw new Error('Invalid grant');
      if(input.grant_type==='refresh_token'&&!/^[a-f0-9]{64}$/.test(input.refresh_token||''))throw new Error('Invalid refresh token');
      try{return json(res,200,await exchange(input));}catch{return json(res,400,{error:'invalid_grant',error_description:'The grant has expired, was already used, or does not match this client.'});}
    }
    return json(res,405,{error:'unsupported_request'});
  }catch(error){return json(res,400,{error:'invalid_request',error_description:error.message});}
}
