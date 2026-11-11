// Workspace membership is separate from authorship. Never pull linked skills
// from another workspace into the map, even if the viewer can access them.
export function workspaceSkills(skills, scope, userId) {
  return skills.filter(s => s.status === 'approved' && (scope === 'personal'
    ? !s.team_id && s.author_id === userId : s.team_id === scope));
}

export function workspaceGraph(skills, scope, userId) {
  const nodes = workspaceSkills(skills, scope, userId).slice().sort((a,b) => a.title.localeCompare(b.title));
  const byId = new Map(nodes.map(s => [s.id,s]));
  const edges = [], outside = new Map();
  for (const parent of nodes) for (const child of parent.definition?.dependencies || []) {
    if (byId.has(child.id)) edges.push({from:parent.id,to:child.id,version:child.version,required:child.required,when:child.when || '',historical:child.version !== byId.get(child.id).version});
    else outside.set(parent.id,(outside.get(parent.id)||0)+1);
  }
  return {nodes,edges,outside,categories:[...new Set(nodes.map(s => s.category || 'Other'))].sort()};
}

// Concentric category branches. Increase the canvas with crowded branches;
// scrolling and zoom keep targets readable instead of overlapping them.
export function layoutGraph(graph) {
  const {nodes,edges,categories} = graph;
  const step = 2*Math.PI/Math.max(categories.length,3);
  const depth = new Map(nodes.map(s => [s.id,0]));
  for (let pass=0;pass<Math.min(nodes.length,6);pass++) {
    let changed=false;
    for (const e of edges) {
      const next=Math.min(6,depth.get(e.from)+1);
      if(next>depth.get(e.to)){depth.set(e.to,next);changed=true;}
    }
    if(!changed)break;
  }
  const layers=[];
  for(const [index,category] of categories.entries()) {
    const members=nodes.filter(s=>(s.category||'Other')===category);
    const grouped=new Map();
    for(const s of members){const d=depth.get(s.id);if(!grouped.has(d))grouped.set(d,[]);grouped.get(d).push(s);}
    for(const [d,list] of grouped)layers.push({category,index,d,list});
  }
  const spread=step*.72;
  const base=Math.max(195,...layers.map(l=>l.list.length*145/spread-l.d*160));
  const radius=Math.max(340,...layers.map(l=>base+l.d*160+105));
  const size=Math.ceil(radius*2+100),center=size/2,positions=new Map();
  const polar=(r,a)=>({x:center+Math.cos(a)*r,y:center+Math.sin(a)*r});
  for(const layer of layers) for(const [i,s] of layer.list.entries()) {
    const a=-Math.PI/2+layer.index*step+(layer.list.length===1?0:(i/(layer.list.length-1)-.5)*spread);
    positions.set(s.id,{...polar(base+layer.d*160,a),angle:a,depth:layer.d});
  }
  return {size,center,radius,positions,branches:categories.map((name,i)=>({name,angle:-Math.PI/2+i*step,...polar(112,-Math.PI/2+i*step),label:polar(radius,-Math.PI/2+i*step)}))};
}

export function connectedPath(graph,id) {
  const ids=new Set([id]),edges=new Set();
  // Follow ancestors and descendants separately: siblings are not dependencies.
  for(const direction of ['from','to']) {
    const visited=new Set([id]),queue=[id],other=direction==='from'?'to':'from';
    for(let i=0;i<queue.length;i++) for(const [index,e] of graph.edges.entries())if(e[direction]===queue[i]){
      edges.add(index);ids.add(e[other]);if(!visited.has(e[other])){visited.add(e[other]);queue.push(e[other]);}
    }
  }
  return {ids,edges};
}
