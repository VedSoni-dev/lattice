// Browser-only product sandbox. Never calls the account API or issues MCP credentials.
import {addTreeExample} from './tree-example.js';
const KEY='lattice-demo-v1';
const USER='demo-you',TEAM='demo-studio';
const now=()=>new Date().toISOString();
export function createDemoStore(storage=localStorage){
  const seed=()=>{
    const stamp=now();
    const skill=(id,author,title,description,method,category,status='approved')=>({id,author_id:author,team_id:status==='draft'?null:TEAM,title,description,method,category,status,source:'codex',version:1,updated_at:stamp});
    return {profile:{id:USER,name:'Alex Morgan'},teams:[{id:TEAM,name:'Studio team',role:'owner'}],members:{[TEAM]:[{id:USER,name:'Alex Morgan',role:'owner',joined_at:stamp},{id:'demo-maya',name:'Maya Chen',role:'member',joined_at:stamp},{id:'demo-sam',name:'Sam Rivera',role:'member',joined_at:stamp}]},invites:[],connections:[],skills:[
      skill('demo-design','demo-maya','Design a clear, consistent page','Maya’s approach to hierarchy, rhythm, and the final ten percent.','1. Name the one thing this page helps someone do.\n2. Give that action the strongest visual hierarchy.\n3. Reuse existing components and spacing values.\n4. Check the smallest screen before polishing the largest.\n5. Remove anything that competes with the primary action.','Design'),
      skill('demo-review',USER,'Review the change, not just the code','A repeatable review that starts with the person using the product.','1. Describe the behavior before and after the change.\n2. Walk through the main user flow.\n3. Check empty, loading, and error states.\n4. Test the boundary most likely to break.\n5. Leave specific feedback with an example.','Engineering'),
      skill('demo-research','demo-sam','Turn interviews into useful decisions','Find the pattern without losing the person behind it.','1. Separate observations from interpretations.\n2. Group repeated problems across interviews.\n3. Keep a concrete example for every pattern.\n4. Write the decision the evidence supports.\n5. Identify what you still need to learn.','Research'),
      skill('demo-draft',USER,'Build accessible forms from the start','Captured from your latest task. Ready for your review.','1. Give every input a visible label.\n2. Explain requirements before submission.\n3. Put errors beside the affected field.\n4. Preserve the user’s input after an error.\n5. Verify keyboard focus and announce submission status.','Engineering','draft')],borrows:0};
  };
  let db;
  try{db=JSON.parse(storage.getItem(KEY));if(!db?.profile||!Array.isArray(db.skills)||!db.members)db=null;}catch{db=null;}
  if(!db)db=seed();
  addTreeExample(db,TEAM);
  db.versions||={};db.loads||=[];
  for(const s of db.skills)if(s.status==='approved')db.versions[s.id+':'+s.version]||=structuredClone(s);
  const save=()=>storage.setItem(KEY,JSON.stringify(db));
  const enrich=s=>({...s,author_name:s.author_id===USER?db.profile.name:Object.values(db.members).flat().find(m=>m.id===s.author_id)?.name||'Teammate',team_name:db.teams.find(t=>t.id===s.team_id)?.name||null});
  const own=id=>{const s=db.skills.find(s=>s.id===id&&s.author_id===USER);if(!s)throw Error('Only the author can change this method.');return s;};
  const team=id=>{const t=db.teams.find(t=>t.id===id);if(!t)throw Error('Team not found.');return t;};
  const cleanSkill=p=>{if(!p.title?.trim()||!p.method?.trim())throw Error('Add a name and a method.');return {title:p.title.trim().slice(0,120),method:p.method.trim().slice(0,20000),description:(p.description||'').slice(0,600),category:p.category||'Engineering',definition:p.definition||{}};};
  const inspect=(id,version)=>{const current=db.skills.find(s=>s.id===id&&s.status!=='archived');if(!current)throw Error('Skill not available.');const s=version&&current.status!=='draft'?db.versions[id+':'+version]:current;if(!s)throw Error('Pinned version unavailable.');return {...enrich(s),current_version:current.version,children:(s.definition?.dependencies||[]).map(dep=>{const c=db.skills.find(x=>x.id===dep.id&&x.status==='approved'),v=c&&db.versions[dep.id+':'+dep.version];return {...dep,available:!!v,title:v?.title||'Unavailable child skill',description:v?.description,author_name:v?enrich(v).author_name:undefined,current_version:c?.version};})};};
  const clone=x=>structuredClone(x);
  save();
  return {userId:USER,defaultTeam:TEAM,reset(){db=seed();addTreeExample(db,TEAM);db.versions={};db.loads=[];for(const s of db.skills)if(s.status==='approved')db.versions[s.id+':'+s.version]=clone(s);save();},async rpc(action,p={}){
    let result;
    switch(action){
      case 'bootstrap':return clone({...db,skills:db.skills.filter(s=>s.status!=='archived').map(enrich)});
      case 'profile':if(!p.name?.trim())throw Error('Add your name.');db.profile.name=p.name.trim().slice(0,100);for(const rows of Object.values(db.members)){const member=rows.find(m=>m.id===USER);if(member)member.name=db.profile.name;}result=db.profile;break;
      case 'skill_create':{const s={...cleanSkill(p),id:crypto.randomUUID(),author_id:USER,team_id:null,status:'draft',source:p.source==='codex'?'codex':'web',version:1,updated_at:now()};db.skills.push(s);result=enrich(s);break;}
      case 'skill_update':{const s=own(p.id);Object.assign(s,cleanSkill(p),{status:'draft',team_id:null,updated_at:now(),version:s.version+1});result=enrich(s);break;}
      case 'skill_approve':case 'skill_share':{const s=own(p.id);if(action==='skill_share'&&s.status!=='approved')throw Error('Approve the method first.');if(p.team_id)team(p.team_id);for(const dep of s.definition?.dependencies||[]){const child=db.skills.find(c=>c.id===dep.id&&c.status==='approved');if(!child||!db.versions[dep.id+':'+dep.version])throw Error('A child skill is unavailable or needs approval.');if(p.team_id&&child.team_id!==p.team_id)throw Error('Share every child with the same team first.');}Object.assign(s,{status:'approved',team_id:p.team_id||null,updated_at:now()});db.versions[s.id+':'+s.version]||=clone(s);result=enrich(s);break;}
      case 'skill_archive':own(p.id).status='archived';result={};break;
      case 'skill_inspect':return clone(inspect(p.id,p.version));
      case 'skill_usage':return clone(db.loads.filter(x=>x.skill_id===p.id||x.parent_skill_id===p.id).slice(-20).reverse());
      case 'skill_borrow':{const s=db.skills.find(s=>s.id===p.id&&s.status==='approved');if(!s)throw Error('Skill not available.');db.borrows++;result=inspect(p.id,p.version);db.loads.push({skill_id:s.id,skill_version:result.version,created_at:now()});break;}
      case 'team_create':{if(!p.name?.trim())throw Error('Give your team a name.');const t={id:crypto.randomUUID(),name:p.name.trim().slice(0,100),role:'owner'};db.teams.push(t);db.members[t.id]=[{id:USER,name:db.profile.name,role:'owner',joined_at:now()}];result=t;break;}
      case 'team_details':team(p.id);return clone({members:db.members[p.id],invites:db.invites.filter(i=>i.team_id===p.id&&!i.accepted&&!i.revoked&&new Date(i.expires_at)>new Date())});
      case 'member_remove':team(p.team_id);if(p.user_id===USER)throw Error('The team owner cannot be removed.');db.members[p.team_id]=db.members[p.team_id].filter(m=>m.id!==p.user_id);db.skills=db.skills.filter(s=>!(s.author_id===p.user_id&&s.team_id===p.team_id));result={};break;
      case 'invite_create':team(p.team_id);result={id:crypto.randomUUID(),token:crypto.randomUUID(),team_id:p.team_id,email:p.email||'',expires_at:new Date(Date.now()+7*86400000).toISOString()};db.invites.push(result);break;
      case 'invite_revoke':{const i=db.invites.find(i=>i.id===p.id);if(i)i.revoked=true;result={};break;}
      case 'invite_preview':case 'invite_accept':{const i=db.invites.find(i=>i.token===p.token&&!i.revoked&&!i.accepted&&new Date(i.expires_at)>new Date());if(!i)throw Error('This demo invitation is unavailable. Open it in the browser where you created it.');const t=team(i.team_id);if(action==='invite_accept'){i.accepted=true;db.members[t.id].push({id:crypto.randomUUID(),name:p.name?.trim()||'New teammate',role:'member',joined_at:now()});}result={team_id:t.id,team_name:t.name};break;}
      default:throw Error('This action needs an account. Explore the browser demo for now.');
    }
    save();return clone(result);
  }};
}
