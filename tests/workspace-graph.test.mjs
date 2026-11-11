import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceSkills,workspaceGraph,layoutGraph,connectedPath} from '../lib/workspace-graph.mjs';

const skill=(id,team_id,more={})=>({id,team_id,title:id,author_id:'me',status:'approved',version:2,category:'Design',...more});
test('workspace maps separate private skills, each team, and drafts',()=>{
 const skills=[skill('private',null),skill('team-a','a'),skill('team-b','b'),skill('draft',null,{status:'draft'}),skill('someone-else',null,{author_id:'other'})];
 assert.deepEqual(workspaceSkills(skills,'personal','me').map(s=>s.id),['private']);
 assert.deepEqual(workspaceSkills(skills,'a','me').map(s=>s.id),['team-a']);
 assert.deepEqual(workspaceSkills(skills,'empty','me'),[]);
});
test('links never pull another workspace into the map and retain pinned versions',()=>{
 const skills=[skill('parent','a',{definition:{dependencies:[{id:'child',version:1,required:true},{id:'external',version:2,required:false}]}}),skill('child','a'),skill('external','b')];
 const graph=workspaceGraph(skills,'a','me');
 assert.equal(graph.nodes.length,2);assert.equal(graph.edges.length,1);
 assert.equal(graph.edges[0].historical,true);assert.equal(graph.edges[0].version,1);
 assert.equal(graph.outside.get('parent'),1);
});
test('highlight traces ancestors and descendants without unrelated sibling paths',()=>{
 const graph={edges:[{from:'a',to:'b'},{from:'a',to:'c'},{from:'b',to:'d'}]};
 const path=connectedPath(graph,'b');assert.deepEqual([...path.ids].sort(),['a','b','d']);assert.deepEqual([...path.edges].sort(),[0,2]);
});
test('dense maps and malformed cyclic inputs terminate with finite in-bounds positions',()=>{
 const skills=Array.from({length:90},(_,i)=>skill('skill-'+i,'a',{category:['Design','Engineering','Writing'][i%3],definition:{dependencies:[{id:'skill-'+((i+1)%90),version:2,required:true}]}}));
 const graph=workspaceGraph(skills,'a','me'),layout=layoutGraph(graph);
 assert.equal(layout.positions.size,90);
 for(const {x,y} of layout.positions.values()){assert.ok(Number.isFinite(x)&&Number.isFinite(y));assert.ok(x>0&&y>0&&x<layout.size&&y<layout.size);}
 assert.equal(connectedPath(graph,'skill-0').ids.size,90);
});
