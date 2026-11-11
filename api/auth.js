import {json,origin} from '../lib/backend.mjs';
import {database,sessionToken,setSessionCookie,readSession,rateLimit,providerRequest} from '../lib/neon.mjs';

export default async function handler(req,res){
  if(!process.env.NEON_AUTH_BASE_URL)return json(res,503,{error:'Account service is not configured.'});
  const action=req.query?.action;
  try{
    if(action==='session'&&req.method==='GET')return json(res,200,{session:await readSession(sessionToken(req))});
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    if(req.headers.origin!==origin())return json(res,403,{error:'Open this request from Lattice.'});
    if(action==='logout'){
      const token=sessionToken(req);if(token)await database()`delete from neon_auth.session where token=${token}`;
      setSessionCookie(res,'',0);return json(res,200,{success:true});
    }
    const input=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const email=String(input.email||'').trim().toLowerCase();
    if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,400,{error:'Enter a valid email address.'});
    if(action==='send'){
      await rateLimit(req,email,'send');
      await providerRequest('/email-otp/send-verification-otp',{email,type:'sign-in'});
      return json(res,200,{success:true});
    }
    if(action==='verify'){
      const otp=String(input.code||'').trim(),name=String(input.name||'').trim().slice(0,100);
      if(!/^\d{6}$/.test(otp))return json(res,400,{error:'Enter the six-digit code from your email.'});
      await rateLimit(req,email,'verify');
      const data=await providerRequest('/sign-in/email-otp',{email,otp,...(name?{name}:{})});
      if(!data.token||!data.user?.emailVerified)throw new Error('Verify your email to finish signing in.');
      const session=await readSession(data.token);
      if(!session)throw new Error('Could not start your session. Request a fresh code.');
      const maxAge=Math.max(0,Math.min(604800,Math.floor((new Date(session.expires_at)-Date.now())/1000)));
      setSessionCookie(res,data.token,maxAge);return json(res,200,{session});
    }
    return json(res,400,{error:'Unknown request'});
  }catch(error){return json(res,error.status>=400&&error.status<500?error.status:400,{error:error.message||'Unable to sign in.'});}
}
