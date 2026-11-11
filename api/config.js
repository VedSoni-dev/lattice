import {publicConfig,json} from '../lib/backend.mjs';
export default function handler(req,res){if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});const config=publicConfig();if(config.provider!=='neon'&&(!config.url||!config.key))return json(res,503,{error:'Account service setup pending'});json(res,200,{...config,emailAuthReady:process.env.EMAIL_AUTH_READY==='true'});}
