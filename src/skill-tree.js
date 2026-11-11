const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function definitionEditor(skill,skills){
  const d=skill?.definition||{},deps=d.dependencies||[];
  const options=skills.filter(s=>s.id!==skill?.id&&(s.status==='approved'||deps.some(c=>c.id===s.id)));
  for(const dep of deps)if(!options.some(s=>s.id===dep.id))options.push({id:dep.id,title:'Unavailable child — remove or restore access',version:dep.version,status:'unavailable'});
  return `<details class="definition-editor" ${Object.keys(d).length?'open':''}><summary>Purpose, checks & child skills</summary><label for="skill-use-when">Use when</label><input id="skill-use-when" name="use_when" maxlength="600" value="${esc(d.use_when)}" placeholder="A visitor needs to understand and act on a new page."><label for="skill-outcome">Expected result</label><input id="skill-outcome" name="outcome" maxlength="600" value="${esc(d.outcome)}" placeholder="A clear, usable page with one primary action.">${[['inputs','Inputs','Brief, audience, existing brand assets'],['checks','Checks for success','Primary action works with keyboard and touch'],['capabilities','Capabilities needed','Read a design, edit an interface']].map(([key,label,placeholder])=>`<label for="skill-${key}">${label} · one per line</label><textarea id="skill-${key}" name="${key}" rows="2" placeholder="${placeholder}">${esc((d[key]||[]).join('\n'))}</textarea>`).join('')}<h3 class="mt">Build on approved skills</h3><p class="small-note">Each child keeps its own author and pinned version. Only selected children become part of this method. Approve new children first.</p><div class="dependency-picker">${options.map(s=>{const dep=deps.find(x=>x.id===s.id);return `<fieldset data-dependency="${esc(s.id)}"><label class="check-label"><input type="checkbox" name="include-child" ${dep?'checked':''}>${esc(s.title)}</label><div class="dependency-options"><label>Version<select name="child-version">${dep&&dep.version!==s.version?`<option value="${dep.version}" selected>v${dep.version} · pinned</option>`:''}<option value="${s.version}" ${!dep||dep.version===s.version?'selected':''}>v${s.version}${dep&&dep.version!==s.version?' · latest (opt in)':''}</option></select></label><label class="check-label"><input name="child-required" type="checkbox" ${dep?.required!==false?'checked':''}>Required step</label></div><label>When to use this child<input name="child-when" maxlength="600" value="${esc(dep?.when)}" placeholder="When choosing the type hierarchy"></label></fieldset>`;}).join('')||'<p class="small-note">Your approved skills will appear here.</p>'}</div></details>`;
}
export function readDefinition(form){
 const definition={schema_version:1,use_when:form.elements.use_when.value.trim(),outcome:form.elements.outcome.value.trim()};
 for(const key of ['inputs','checks','capabilities']){definition[key]=form.elements[key].value.split('\n').map(x=>x.trim()).filter(Boolean);if(definition[key].length>12||definition[key].some(x=>x.length>600))throw Error('Use up to 12 short lines per field.');}
 definition.dependencies=[...form.querySelectorAll('[data-dependency]')].filter(el=>el.querySelector('[name=include-child]').checked).map(el=>({id:el.dataset.dependency,version:Number(el.querySelector('[name=child-version]').value),required:el.querySelector('[name=child-required]').checked,when:el.querySelector('[name=child-when]').value.trim()}));
 if(definition.dependencies.length>12)throw Error('Choose up to 12 child skills.');
 return definition;
}
function childrenView(children,depth){return children?.length?`<div class="skill-tree" aria-label="Child skills">${children.map(c=>`<details class="tree-node" data-node-id="${esc(c.id)}" data-node-version="${c.version}" data-depth="${depth}"><summary><span class="tree-marker" aria-hidden="true">↳</span><span><strong>${esc(c.title)}</strong><small>v${c.version} · ${c.required?'Required':'Optional'}${c.author_name?' · '+esc(c.author_name):''}${c.current_version>c.version?' · newer version available':''}</small></span><span class="badge">${c.available===false?'UNAVAILABLE':'EXPAND'}</span></summary><div class="tree-node-body"><p>${esc(c.when||c.description)}</p>${c.available===false?'<p class="form-error">Access to this child changed. Restore access or revise the parent before relying on this step.</p>':'<div data-node-content><p class="small-note">Loading this step…</p></div>'}</div></details>`).join('')}</div>`:'';}
export function skillBody(skill,depth=0){
 const d=skill.definition||{};
 return `${d.outcome?`<div class="skill-outcome"><span class="eyebrow">EXPECTED RESULT</span><p>${esc(d.outcome)}</p></div>`:''}${d.use_when?`<p class="description"><strong>Use when:</strong> ${esc(d.use_when)}</p>`:''}${d.inputs?.length?`<p class="description"><strong>Inputs:</strong> ${d.inputs.map(esc).join(' · ')}</p>`:''}${d.capabilities?.length?`<p class="description"><strong>Needs:</strong> ${d.capabilities.map(esc).join(' · ')}</p>`:''}<div class="activity-method">${esc(skill.method)}</div>${skill.children?.length?`<h3 class="mt">Built on ${skill.children.length} ${skill.children.length===1?'method':'methods'}</h3><p class="small-note">Expand one step at a time. Versions stay pinned until the author changes them.</p>${childrenView(skill.children,depth+1)}`:''}${d.checks?.length?`<div class="skill-checks"><h3>Check the result</h3><ul>${d.checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`:''}`;
}
export function wireTree(container,rpc){
 for(const details of container.querySelectorAll('details[data-node-id]')){
  if(details.dataset.wired)continue;details.dataset.wired='true';
  details.addEventListener('toggle',async()=>{
   if(!details.open||details.dataset.loaded)return;
   const target=details.querySelector('[data-node-content]');if(!target)return;
   const depth=Number(details.dataset.depth);
   if(depth>12){target.textContent='Open this skill separately to explore deeper steps.';return;}
   details.dataset.loaded='loading';
   try{const child=await rpc('skill_inspect',{id:details.dataset.nodeId,version:Number(details.dataset.nodeVersion)});if(!details.isConnected)return;target.innerHTML=skillBody(child,depth);details.dataset.loaded='true';wireTree(target,rpc);}catch(error){delete details.dataset.loaded;target.textContent=error.message+' Close and reopen this step to retry.';}
  });
 }
}
