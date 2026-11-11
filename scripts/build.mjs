import {installPrompt} from '../lib/install-prompt.mjs';
import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const file of ['index.html','styles.css','app.js','app.html','workspace.css','workspace-tree.css','tree-tokens.css','install.html'])await copyFile(file,'dist/'+file);
if(process.env.EMAIL_AUTH_READY==='true'){
  const landing=(await readFile('index.html','utf8'))
    .replace('<a class="nav-link" href="/demo?view=connect">See the flow','<a class="nav-link" href="/login">Log in')
    .replace('<a class="nav-cta" href="/demo">Open demo','<a class="nav-cta" href="/signup">Get started')
    .replace('<a class="btn primary" href="/demo">Try the demo','<a class="btn primary" href="/signup">Get started');
  await writeFile('dist/index.html',landing);
}
await build({entryPoints:['src/workspace.js'],bundle:true,minify:true,format:'esm',outfile:'dist/workspace.js',target:'es2022'});
const widget=await build({entryPoints:['src/approval-card.js'],bundle:true,minify:true,format:'iife',write:false,target:'es2022'});
const html=(await readFile('src/approval-card.html','utf8')).replace('/* APP_SCRIPT */',widget.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await writeFile('dist/approval-card.html',html);
for(const dir of ['downloads','media'])try{await cp(dir,'dist/'+dir,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Built Lattice website, workspace, and inline approval card.');

await build({entryPoints:['src/install-page.js'],bundle:true,minify:true,format:'esm',outfile:'dist/install-page.js',target:'es2022'});
await writeFile('dist/install.txt',installPrompt()+'\n');
