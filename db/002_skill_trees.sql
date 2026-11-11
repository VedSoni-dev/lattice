-- Additive migration: preserve existing skills, approvals, and connections.
alter table lattice_private.skills add column definition jsonb not null default '{}';
alter table lattice_private.skills drop constraint skills_source_check;
alter table lattice_private.skills add constraint skills_source_check check(source in ('web','codex','claude','cursor','mcp'));
create table lattice_private.skill_versions (
  skill_id uuid not null references lattice_private.skills(id),
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key(skill_id,version)
);
alter table lattice_private.skill_versions enable row level security;
revoke all on lattice_private.skill_versions from public,anon,authenticated;
alter table lattice_private.events add column skill_version integer;
alter table lattice_private.events add column parent_skill_id uuid references lattice_private.skills(id);
alter table lattice_private.events add column parent_version integer;

create function lattice_private.validate_definition(u uuid,d jsonb,parent uuid,share_team uuid default null) returns void
language plpgsql set search_path='' as $$
declare dep jsonb; child lattice_private.skills; seen text[]:='{}'; queue jsonb:=coalesce(d->'dependencies','[]'); item jsonb; snap jsonb; key text; n int:=0;
begin
  if d is null or jsonb_typeof(d)<>'object' then raise exception 'Skill definition must be an object'; end if;
  if length(d::text)>24000 or length(coalesce(d->>'use_when',''))>600 or length(coalesce(d->>'outcome',''))>600 then raise exception 'Skill definition is too long'; end if;
  if d ? 'schema_version' and d->>'schema_version'<>'1' then raise exception 'Unsupported skill format'; end if;
  foreach key in array array['inputs','checks','capabilities','dependencies'] loop
    if d ? key and (jsonb_typeof(d->key)<>'array' or jsonb_array_length(d->key)>12) then raise exception 'Use at most 12 items per skill field'; end if;
  end loop;
  foreach key in array array['inputs','checks','capabilities'] loop
    for item in select value from jsonb_array_elements(coalesce(d->key,'[]')) loop
      if jsonb_typeof(item)<>'string' or length(item#>>'{}')>600 then raise exception 'Skill fields must contain short text items'; end if;
    end loop;
  end loop;
  if (select count(*) from jsonb_array_elements(queue))<>(select count(distinct value->>'id') from jsonb_array_elements(queue)) then raise exception 'Each child skill can appear only once'; end if;
  while jsonb_array_length(queue)>0 loop
    dep:=queue->0; queue:=queue-0; n:=n+1;
    if n>144 then raise exception 'Skill tree exceeds 144 links'; end if;
    if jsonb_typeof(dep)<>'object' or coalesce(dep->>'id','') !~ '^[a-fA-F0-9-]{36}$' or coalesce(dep->>'version','') !~ '^[1-9][0-9]{0,8}$' or jsonb_typeof(dep->'required') is distinct from 'boolean' or length(coalesce(dep->>'when',''))>600 then raise exception 'Child skills need an id, pinned version, required flag, and short condition'; end if;
    if (dep->>'id')::uuid=parent then raise exception 'A skill cannot depend on itself, including through other skills'; end if;
    key:=(dep->>'id')||':'||(dep->>'version');
    if key=any(seen) then continue; end if;
    seen:=array_append(seen,key);
    select * into child from lattice_private.skills where id=(dep->>'id')::uuid for share;
    if child.id is null or child.status<>'approved' or not lattice_private.can_read(u,child) then raise exception 'A child skill is unavailable or needs approval' using errcode='42501'; end if;
    if share_team is not null and child.team_id is distinct from share_team then raise exception 'Share every child skill with the same team before sharing the parent'; end if;
    select snapshot into snap from lattice_private.skill_versions where skill_id=child.id and version=(dep->>'version')::int;
    if snap is null then raise exception 'Pinned child version is not approved'; end if;
    queue:=queue||coalesce(snap->'definition'->'dependencies','[]');
  end loop;
end;
$$;

create function lattice_private.freeze_skill() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='approved' then
    perform lattice_private.validate_definition(new.author_id,new.definition,new.id,new.team_id);
    insert into lattice_private.skill_versions(skill_id,version,snapshot)
      values(new.id,new.version,lattice_private.skill_json(new)) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger freeze_skill_version after insert or update on lattice_private.skills for each row execute function lattice_private.freeze_skill();
insert into lattice_private.skill_versions(skill_id,version,snapshot)
  select id,version,lattice_private.skill_json(s) from lattice_private.skills s where status='approved';

-- Versions retain content; access always follows the skill's current visibility.
create function lattice_private.load_version(u uuid,target uuid,wanted int default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare s lattice_private.skills; snapshot jsonb;
begin
  select * into s from lattice_private.skills where id=target;
  if s.id is null or s.status<>'approved' or not lattice_private.can_read(u,s) then raise exception 'Skill not available' using errcode='42501'; end if;
  select v.snapshot into snapshot from lattice_private.skill_versions v where v.skill_id=target and v.version=coalesce(wanted,s.version);
  if snapshot is null then raise exception 'Approved version not available'; end if;
  return snapshot||jsonb_build_object('team_id',s.team_id,'team_name',(select name from lattice_private.teams where id=s.team_id),'author_name',(select name from lattice_private.profiles where id=s.author_id),'current_version',s.version,'status','approved');
end;
$$;
create function lattice_private.inspect_node(u uuid,snapshot jsonb,include_method boolean default false) returns jsonb
language plpgsql stable set search_path='' as $$
declare dep jsonb; child jsonb; children jsonb:='[]'; answer jsonb;
begin
  for dep in select value from jsonb_array_elements(coalesce(snapshot->'definition'->'dependencies','[]')) loop
    begin
      child:=lattice_private.load_version(u,(dep->>'id')::uuid,(dep->>'version')::int);
      children:=children||jsonb_build_array(dep||jsonb_build_object('available',true,'title',child->>'title','description',child->>'description','use_when',child->'definition'->>'use_when','outcome',child->'definition'->>'outcome','author_name',child->>'author_name','current_version',child->'current_version','child_count',jsonb_array_length(coalesce(child->'definition'->'dependencies','[]'))));
    exception when others then
      children:=children||jsonb_build_array(dep||jsonb_build_object('available',false,'title','Unavailable child skill'));
    end;
  end loop;
  answer:=snapshot||jsonb_build_object('children',children);
  if not include_method then answer:=(answer-'method')||jsonb_build_object('definition',coalesce(snapshot->'definition','{}')-'checks'-'inputs'); end if;
  return answer;
end;
$$;

-- Keep the established auth and team behavior behind private wrappers.
alter function public.lattice_web(text,jsonb) rename to lattice_web_v1;
alter function public.lattice_web_v1(text,jsonb) set schema lattice_private;
alter function public.lattice_agent(text,text,jsonb) rename to lattice_agent_v1;
alter function public.lattice_agent_v1(text,text,jsonb) set schema lattice_private;
revoke all on function lattice_private.lattice_web_v1(text,jsonb) from public,anon,authenticated;
revoke all on function lattice_private.lattice_agent_v1(text,text,jsonb) from public,anon,authenticated;

create function lattice_private.borrow_version(u uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s jsonb; parent jsonb; parent_id uuid:=nullif(payload->>'parent_id','')::uuid;
begin
  s:=lattice_private.load_version(u,(payload->>'id')::uuid,(payload->>'version')::int);
  if parent_id is not null then
    parent:=lattice_private.load_version(u,parent_id,(payload->>'parent_version')::int);
    if not exists(select 1 from jsonb_array_elements(coalesce(parent->'definition'->'dependencies','[]')) d where d->>'id'=s->>'id' and d->>'version'=s->>'version') then raise exception 'This version is not a child of the specified parent'; end if;
  end if;
  insert into lattice_private.events(user_id,team_id,skill_id,action,skill_version,parent_skill_id,parent_version)
    values(u,(s->>'team_id')::uuid,(s->>'id')::uuid,'borrow',(s->>'version')::int,parent_id,(parent->>'version')::int);
  return lattice_private.inspect_node(u,s,true);
end;
$$;

create function public.lattice_web(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; u uuid:=auth.uid(); s lattice_private.skills;
begin
  if action in ('skill_inspect','skill_borrow','skill_usage') then
    -- Reuse the established identity and verified-email checks.
    perform lattice_private.lattice_web_v1('bootstrap','{}');
    if action='skill_borrow' then return lattice_private.borrow_version(u,payload); end if;
    select * into s from lattice_private.skills where id=(payload->>'id')::uuid;
    if s.id is null or not lattice_private.can_read(u,s) or s.status='archived' then raise exception 'Skill not available' using errcode='42501'; end if;
    if action='skill_usage' then
      return coalesce((select jsonb_agg(to_jsonb(q)) from (select ev.skill_id,ev.skill_version,ev.parent_skill_id,ev.parent_version,ev.created_at from lattice_private.events ev where ev.user_id=u and ev.action='borrow' and (ev.skill_id=s.id or ev.parent_skill_id=s.id) order by ev.created_at desc limit 20) q),'[]');
    end if;
    answer:=case when s.status='draft' then lattice_private.skill_json(s) else lattice_private.load_version(u,s.id,(payload->>'version')::int) end;
    return lattice_private.inspect_node(u,answer,true);
  end if;
  answer:=lattice_private.lattice_web_v1(action,payload);
  if action in ('skill_create','skill_update') then
    perform lattice_private.validate_definition(u,coalesce(payload->'definition','{}'),(answer->>'id')::uuid);
    update lattice_private.skills set definition=coalesce(payload->'definition','{}') where id=(answer->>'id')::uuid returning * into s;
    answer:=lattice_private.skill_json(s);
  end if;
  return answer;
end;
$$;

create function public.lattice_agent(access_token text,action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; account jsonb; u uuid; s lattice_private.skills; client_name text;
begin
  if action in ('inspect','borrow') then
    account:=lattice_private.lattice_agent_v1(access_token,'context','{}'); u:=(account->>'user_id')::uuid;
    if action='borrow' then return lattice_private.borrow_version(u,payload); end if;
    return lattice_private.inspect_node(u,lattice_private.load_version(u,(payload->>'id')::uuid,(payload->>'version')::int));
  end if;
  answer:=lattice_private.lattice_agent_v1(access_token,action,payload);
  if action='propose' then
    u:=(answer->'skill'->>'author_id')::uuid;
    perform lattice_private.validate_definition(u,coalesce(payload->'definition','{}'),(answer->'skill'->>'id')::uuid);
    select lower(name) into client_name from lattice_private.connections where token_hash=lattice_private.hash(access_token);
    update lattice_private.skills set definition=coalesce(payload->'definition','{}'),source=case when client_name like '%claude%' then 'claude' when client_name like '%cursor%' then 'cursor' when client_name like '%codex%' then 'codex' else 'mcp' end where id=(answer->'skill'->>'id')::uuid returning * into s;
    answer:=jsonb_set(answer,'{skill}',lattice_private.inspect_node(u,lattice_private.skill_json(s),true));
  end if;
  return answer;
end;
$$;
revoke all on all functions in schema lattice_private from public,anon,authenticated;
revoke all on function public.lattice_web(text,jsonb) from public,anon;
grant execute on function public.lattice_web(text,jsonb) to authenticated;
revoke all on function public.lattice_agent(text,text,jsonb) from public;
grant execute on function public.lattice_agent(text,text,jsonb) to anon,authenticated;
