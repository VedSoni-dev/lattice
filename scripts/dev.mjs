import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import config from '../api/config.js';
import oauth from '../api/oauth.js';
import mcp from '../api/mcp.js';
import auth from '../api/auth.js';
import workspace from '../api/workspace.js';
const port=Number(process.env.PORT||4174),base=resolve('dist');
try{process.loadEnvFile('.env.local');}catch{}
const routes={'/.well-known/oauth-protected-resource':'resource','/.well-known/oauth-protected-resource/mcp':'resource','/.well-known/oauth-authorization-server':'metadata','/oauth/register':'register','/oauth/token':'token'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');req.query=Object.fromEntries(url.searchParams);const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413);res.end();return;}chunks.push(chunk);}const raw=Buffer.concat(chunks).toString();req.body=raw?(req.headers['content-type']?.includes('application/json')?JSON.parse(raw):req.headers['content-type']?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(raw)):raw):undefined;
if(url.pathname==='/api/auth')return auth(req,res);if(url.pathname==='/api/workspace')return workspace(req,res);if(url.pathname==='/api/config')return config(req,res);if(url.pathname==='/mcp'||url.pathname==='/api/mcp')return mcp(req,res);if(url.pathname==='/api/oauth'||routes[url.pathname]){if(routes[url.pathname])req.query.action=routes[url.pathname];return oauth(req,res);}
const path=url.pathname==='/install'?'install.html':['/demo','/app','/login','/signup','/join','/authorize'].includes(url.pathname)?'app.html':url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const file=resolve(base,path);if(!file.startsWith(base+'/')&&!file.startsWith(base+'\\')){res.writeHead(403);res.end();return;}const info=await stat(file);if(!info.isFile())throw new Error('Not found');res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.zip':'application/zip'})[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));}catch(error){res.statusCode=error.code==='ENOENT'?404:500;res.end(error.message);}}).listen(port,'127.0.0.1',()=>console.log('Lattice development server: http://127.0.0.1:'+port));
