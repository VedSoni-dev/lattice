import {workspaceGraph,layoutGraph,connectedPath} from '../lib/workspace-graph.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(s,n=22)=>s.length>n?s.slice(0,n-1)+'…':s;
const nodeLabel=s=>{const words=s.split(/\s+/);let first='';while(words.length&&(first+' '+words[0]).trim().length<=22)first+=(first?' ':'')+words.shift();if(!first)first=words.shift();return '<tspan x="0">'+esc(short(first))+'</tspan><tspan x="0" dy="19">'+esc(short(words.join(' ')))+'</tspan>';};
const glyphs={Design:'◇',Engineering:'⌘',Writing:'¶',Research:'⌕',Product:'▣',Other:'⊕'};
const url=(base,id,version)=>`${base}?skill=${encodeURIComponent(id)}&version=${version}`;

export function treeView(data,scope,base) {
  const graph=workspaceGraph(data.skills,scope,data.profile.id);
  const name=scope==='personal'?'Personal workspace':data.teams.find(t=>t.id===scope)?.name||'Workspace';
  return {graph,name,html:`<section class="atlas" aria-label="Workspace skill tree">
    <header class="atlas-heading"><div><p class="eyebrow">YOUR WORKSPACE, BRANCH BY BRANCH</p><h1>Skill tree<span class="atlas-period">.</span></h1><p class="description">The methods in ${esc(name)}. Explore how they build on one another.</p></div><div class="atlas-actions"><a data-route href="${base}" class="button secondary">Skill library ↗</a><button class="button" id="tree-new">+ New skill</button></div></header>
    <div class="atlas-frame"><div class="atlas-bar"><div class="atlas-workspace"><span aria-hidden="true">◎</span><strong>${esc(name)}</strong><span class="atlas-scope">${scope==='personal'?'PRIVATE':'TEAM WORKSPACE'}</span></div><div class="atlas-counts"><span><b>${graph.nodes.length}</b> skills</span><span><b>${graph.edges.length}</b> links</span><span><b>${graph.categories.length}</b> branches</span></div></div>
    ${graph.nodes.length?`<div class="atlas-layout"><div class="atlas-explorer"><div class="atlas-controls"><label class="visually-hidden" for="tree-find">Find a skill in this workspace</label><input id="tree-find" placeholder="Find a skill…" type="search" autocomplete="off"><div class="atlas-zoom"><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-zoom="fit">Fit</button><button type="button" data-zoom="in" aria-label="Zoom in">+</button></div></div><div class="atlas-scroll" tabindex="0" role="region" aria-label="Skill map. Scroll to explore; use the skill selector to choose a method."><div class="atlas-canvas"></div></div><div class="atlas-legend"><span><i class="legend-required"></i>Required child</span><span><i class="legend-optional"></i>Optional child</span><span><i class="legend-branch"></i>Category branch</span></div><div class="atlas-select"><label for="tree-select">Jump to a skill</label><select id="tree-select"><option value="">Choose a method</option>${graph.nodes.map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · v${s.version}</option>`).join('')}</select><p id="tree-search-status" role="status"></p></div></div><aside class="atlas-inspector" aria-label="Selected skill"><div id="tree-inspector"></div></aside></div>`:`<div class="atlas-empty"><span class="atlas-empty-symbol" aria-hidden="true">▦</span><h2>Your first branch starts here.</h2><p>${scope==='personal'?'Your private approved skills will appear here.':'Skills shared with this team will appear here.'} Approve a method, then connect it to other skills as your workspace grows.</p><button class="button" id="tree-first">Create a skill ↗</button><a data-route href="${base}?view=drafts">Review your drafts ↗</a></div>`}
    <footer class="atlas-footer"><span>Every node is an approved method.</span><span>${scope==='personal'?'Only your private skills appear here.':'Only skills shared with this workspace appear here.'}</span></footer></div></section>`};
}

function graphSvg(graph,layout,name) {
  const {size,center,positions,branches,radius}=layout;
  const line=(a,b)=>`x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`;
  const incoming=new Set(graph.edges.filter(e=>!e.historical).map(e=>e.to));
  return `<svg viewBox="0 0 ${size} ${size}" class="atlas-svg" aria-label="${esc(name)} skill relationships">
    <g aria-hidden="true" class="atlas-guides"><circle cx="${center}" cy="${center}" r="${radius-60}"/><circle cx="${center}" cy="${center}" r="155"/>${branches.map(b=>`<line ${line({x:center,y:center},b.label)}/>`).join('')}</g>
    <g aria-hidden="true">${graph.nodes.filter(s=>!incoming.has(s.id)).map(s=>{const b=branches.find(b=>b.name===(s.category||'Other'));return `<line class="atlas-branch-link" ${line(b,positions.get(s.id))}/>`;}).join('')}${branches.map(b=>`<line class="atlas-branch-link" ${line({x:center,y:center},b)}/>`).join('')}</g>
    <g aria-hidden="true">${graph.edges.map((e,i)=>`<line data-edge="${i}" class="atlas-edge ${e.required?'required':'optional'} ${e.historical?'historical':''}" ${line(positions.get(e.from),positions.get(e.to))}/>`).join('')}</g>
    <g class="atlas-core" aria-hidden="true" transform="translate(${center} ${center})"><circle r="68"/><circle r="58"/><path d="M 0 -47 L 41 24 L -41 24 Z M 0 47 L -41 -24 L 41 -24 Z"/><circle r="29"/><text text-anchor="middle" y="11">▦</text><text class="atlas-core-label" text-anchor="middle" y="89">WORKSPACE</text></g>
    ${branches.map(b=>`<g aria-hidden="true" class="atlas-branch"><circle cx="${b.x}" cy="${b.y}" r="5"/><text x="${b.label.x}" y="${b.label.y}" text-anchor="middle">${esc(b.name.toUpperCase())}</text></g>`).join('')}
    ${graph.nodes.map(s=>{const p=positions.get(s.id),composed=(s.definition?.dependencies?.length||0)>0;return `<g role="button" tabindex="0" aria-label="${esc(s.title)}, version ${s.version}" aria-pressed="false" class="atlas-node" data-skill-node="${esc(s.id)}" transform="translate(${p.x} ${p.y})"><title>${esc(s.title)} · v${s.version}</title><circle class="atlas-hit" r="32"/>${composed?'<path class="atlas-node-ring" d="M -24 -14 L 0 -28 L 24 -14 L 24 14 L 0 28 L -24 14 Z"/>':'<circle class="atlas-node-ring" r="22"/>'}<text class="atlas-node-icon" text-anchor="middle" y="6" aria-hidden="true">${glyphs[s.category]||'⊕'}</text><text class="atlas-node-title" text-anchor="middle" y="49" aria-hidden="true">${nodeLabel(s.title)}</text><text class="atlas-node-version" text-anchor="middle" y="89" aria-hidden="true">v${s.version}${composed?' · '+s.definition.dependencies.length+' children':''}</text></g>`;}).join('')}
  </svg>`;
}

export function wireWorkspaceTree(container,{graph,name,scope,base,rpc,onCreate}) {
  container.querySelector('#tree-new').onclick=onCreate;
  container.querySelector('#tree-first')?.addEventListener('click',onCreate);
  if(!graph.nodes.length)return;
  const layout=layoutGraph(graph),canvas=container.querySelector('.atlas-canvas'),scroll=container.querySelector('.atlas-scroll');
  const panel=container.querySelector('#tree-inspector'),select=container.querySelector('#tree-select'),find=container.querySelector('#tree-find');
  canvas.innerHTML=graphSvg(graph,layout,name);
  let request=0,selected='',zoom=1;
  const overview=()=>{panel.innerHTML=`<p class="atlas-kicker">COLLECTIVE KNOW-HOW</p><div class="atlas-inspector-symbol" aria-hidden="true">▦</div><h2>A better way,<br> connected.</h2><p>Select a node to explore its method and the skills it builds on.</p><div class="atlas-breakdown">${graph.categories.map(c=>`<div><span>${glyphs[c]||'⊕'} &nbsp; ${esc(c)}</span><b>${graph.nodes.filter(s=>(s.category||'Other')===c).length}</b></div>`).join('')}</div><p class="atlas-hint">Hexagons combine other methods. Circles are individual skills. Gold traces the selected method’s connections.</p>`;};
  overview();
  function fit(){zoom=1;canvas.style.width=Math.max(600,scroll.clientWidth)+'px';scroll.scrollLeft=(scroll.scrollWidth-scroll.clientWidth)/2;scroll.scrollTop=Math.max(0,(scroll.scrollHeight-scroll.clientHeight)/2);}
  fit();
  const resize=new ResizeObserver(()=>{if(!container.isConnected){resize.disconnect();return;}if(zoom===1)fit();});
  resize.observe(scroll);
  container.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{if(b.dataset.zoom==='fit'){fit();return;}const previous=canvas.getBoundingClientRect().width;zoom=Math.max(.6,Math.min(Math.max(3,layout.size/Math.max(600,scroll.clientWidth)*1.2),zoom*(b.dataset.zoom==='in'?1.3:1/1.3)));const next=Math.max(600,scroll.clientWidth)*zoom,ratio=next/previous;canvas.style.width=next+'px';scroll.scrollLeft=(scroll.scrollLeft+scroll.clientWidth/2)*ratio-scroll.clientWidth/2;scroll.scrollTop=(scroll.scrollTop+scroll.clientHeight/2)*ratio-scroll.clientHeight/2;});
  async function choose(id,version,linkInfo) {
    const skill=graph.nodes.find(s=>s.id===id);if(!skill)return;
    const currentRequest=++request;selected=id;select.value=id;
    const active=connectedPath(graph,id);
    canvas.querySelectorAll('[data-skill-node]').forEach(el=>{el.classList.toggle('selected',el.dataset.skillNode===id);el.classList.toggle('connected',active.ids.has(el.dataset.skillNode));el.setAttribute('aria-pressed',String(el.dataset.skillNode===id));});
    canvas.querySelectorAll('[data-edge]').forEach(el=>el.classList.toggle('active',active.edges.has(Number(el.dataset.edge))));
    const selectedVersion=version||skill.version;
    const locationUrl=new URL(location.href);locationUrl.searchParams.set('node',id);locationUrl.searchParams.set('nodeVersion',selectedVersion);locationUrl.searchParams.set('workspace',scope);history.replaceState({},'',locationUrl);
    panel.innerHTML=`<p class="atlas-kicker">${esc(skill.category)} / VERSION ${selectedVersion}</p><h2>${esc(skill.title)}</h2><p role="status">Opening method…</p>`;
    try {
      const full=await rpc('skill_inspect',{id,version:selectedVersion});
      if(currentRequest!==request||!container.isConnected)return;
      const d=full.definition||{},children=full.children||[];
      panel.innerHTML=`<p class="atlas-kicker">${esc(full.category)} / VERSION ${full.version}</p><h2>${esc(full.title)}</h2><p class="atlas-author">Method by ${esc(full.author_name)}</p>${linkInfo?`<p class="atlas-pin">${linkInfo.required?'Required':'Optional'} child · pinned v${selectedVersion}</p>`:''}${full.version!==skill.version?`<p class="atlas-pin">This parent uses v${full.version}. The map’s current node is v${skill.version}.</p>`:''}<p>${esc(d.use_when||full.description)}</p>${d.outcome?`<section><h3>Expected result</h3><p>${esc(d.outcome)}</p></section>`:''}<section><h3>The method</h3><div class="atlas-method">${esc(full.method)}</div></section>${children.length?`<section><h3>Builds on ${children.length} ${children.length===1?'skill':'skills'}</h3><div class="atlas-children">${children.map((c,i)=>{const inside=graph.nodes.some(s=>s.id===c.id);return inside&&c.available!==false?`<button data-child-index="${i}"><span>${esc(c.title)}</span><small>${c.required?'Required':'Optional'} · v${c.version} ↗</small>${c.when?`<em>${esc(c.when)}</em>`:''}</button>`:`<div class="atlas-unavailable"><span>${inside?'Unavailable method':'Child outside this workspace'}</span><small>${c.required?'Required':'Optional'} · v${c.version}</small></div>`;}).join('')}</div></section>`:''}${d.checks?.length?`<section><h3>Check the result</h3><ul>${d.checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></section>`:''}<a data-route class="button atlas-open" href="${url(base,id,full.version)}">Open full skill ↗</a><button class="atlas-clear" id="tree-clear">Back to workspace overview</button>`;
      panel.querySelectorAll('[data-child-index]').forEach(button=>button.onclick=()=>{const c=children[Number(button.dataset.childIndex)];choose(c.id,c.version,c);});
      panel.querySelector('#tree-clear').onclick=clear;
    }catch(error){if(currentRequest!==request||!container.isConnected)return;panel.innerHTML=`<h2>Method unavailable.</h2><p role="alert">${esc(error.message||'Could not load this version.')}</p><button class="button" id="tree-retry">Try again</button>`;panel.querySelector('#tree-retry').onclick=()=>choose(id,version,linkInfo);}
  }
  function clear(){request++;selected='';select.value='';canvas.querySelectorAll('.selected,.connected,.active').forEach(el=>el.classList.remove('selected','connected','active'));canvas.querySelectorAll('[data-skill-node]').forEach(el=>el.setAttribute('aria-pressed','false'));const u=new URL(location.href);u.searchParams.delete('node');u.searchParams.delete('nodeVersion');history.replaceState({},'',u);overview();}
  canvas.querySelectorAll('[data-skill-node]').forEach(el=>{el.onclick=()=>choose(el.dataset.skillNode);el.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(el.dataset.skillNode);}};});
  select.onchange=()=>select.value?choose(select.value):clear();
  find.oninput=()=>{const q=find.value.trim().toLowerCase(),matches=graph.nodes.filter(s=>(s.title+' '+s.category+' '+s.description).toLowerCase().includes(q)),ids=new Set(matches.map(s=>s.id));canvas.querySelectorAll('[data-skill-node]').forEach(el=>el.classList.toggle('search-muted',!!q&&!ids.has(el.dataset.skillNode)));select.innerHTML='<option value="">Choose a method</option>'+matches.map(s=>`<option value="${esc(s.id)}" ${selected===s.id?'selected':''}>${esc(s.title)} · v${s.version}</option>`).join('');container.querySelector('#tree-search-status').textContent=q?`${matches.length} matching ${matches.length===1?'skill':'skills'}.`:'';};
  find.onkeydown=event=>{if(event.key==='Enter'){const first=select.querySelector('option[value]:not([value=""])');if(first)choose(first.value);}};
  const initial=new URLSearchParams(location.search);if(initial.get('node'))choose(initial.get('node'),Number(initial.get('nodeVersion'))||undefined);
}
