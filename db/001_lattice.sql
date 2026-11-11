create extension if not exists pgcrypto with schema extensions;
create schema if not exists lattice_private;
revoke all on schema lattice_private from public, anon, authenticated;

create table lattice_private.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 100),
  created_at timestamptz not null default now()
);
create table lattice_private.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 100),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table lattice_private.members (
  team_id uuid not null references lattice_private.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key(team_id,user_id)
);
create index members_user_idx on lattice_private.members(user_id);
create table lattice_private.invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references lattice_private.teams(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  token_hash text not null unique,
  email text,
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table lattice_private.skills (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id),
  team_id uuid references lattice_private.teams(id),
  title text not null check(length(title) between 1 and 120),
  description text not null default '' check(length(description)<=600),
  method text not null check(length(method) between 1 and 20000),
  category text not null default 'Engineering' check(length(category)<=40),
  status text not null default 'draft' check(status in ('draft','approved','archived')),
  source text not null default 'web' check(source in ('web','codex')),
  version integer not null default 1,
  approval_hash text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index skills_author_idx on lattice_private.skills(author_id);
create index skills_team_idx on lattice_private.skills(team_id,status);
create table lattice_private.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 100),
  token_hash text not null unique,
  refresh_hash text unique,
  client_id text,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table lattice_private.oauth_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text not null,
  redirect_uri text not null,
  challenge text not null,
  resource text not null,
  expires_at timestamptz not null default now()+interval '5 minutes'
);
create table lattice_private.events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  team_id uuid references lattice_private.teams(id),
  skill_id uuid references lattice_private.skills(id),
  action text not null,
  created_at timestamptz not null default now()
);
create index events_user_time_idx on lattice_private.events(user_id,created_at);

alter table lattice_private.profiles enable row level security;
alter table lattice_private.teams enable row level security;
alter table lattice_private.members enable row level security;
alter table lattice_private.invites enable row level security;
alter table lattice_private.skills enable row level security;
alter table lattice_private.connections enable row level security;
alter table lattice_private.oauth_codes enable row level security;
alter table lattice_private.events enable row level security;
revoke all on all tables in schema lattice_private from public,anon,authenticated;

create function lattice_private.hash(value text) returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(value,'sha256'),'hex');
$$;
create function lattice_private.is_member(u uuid,t uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from lattice_private.members where user_id=u and team_id=t);
$$;
create function lattice_private.is_owner(u uuid,t uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from lattice_private.members where user_id=u and team_id=t and role='owner');
$$;
create function lattice_private.can_read(u uuid,s lattice_private.skills) returns boolean language sql stable set search_path='' as $$
  select s.author_id=u or (s.status='approved' and s.team_id is not null and lattice_private.is_member(u,s.team_id));
$$;
create function lattice_private.skill_json(s lattice_private.skills) returns jsonb language sql stable set search_path='' as $$
  select (to_jsonb(s)-'approval_hash') || jsonb_build_object('author_name',coalesce((select name from lattice_private.profiles where id=s.author_id),'Teammate'),'team_name',(select name from lattice_private.teams where id=s.team_id));
$$;

create function public.lattice_web(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); t uuid; target uuid; s lattice_private.skills; inv lattice_private.invites;
  answer jsonb; raw_token text; code text; team_name text; email_address text;
begin
  if u is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  select email into email_address from auth.users where id=u and email_confirmed_at is not null;
  if email_address is null then raise exception 'Verify your email before continuing' using errcode='42501'; end if;
  insert into lattice_private.profiles(id,name) select u,left(coalesce(nullif(raw_user_meta_data->>'name',''),split_part(email,'@',1)),100) from auth.users where id=u on conflict do nothing;
  if action='bootstrap' then
    return jsonb_build_object(
      'profile',(select to_jsonb(p) from lattice_private.profiles p where id=u),
      'teams',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at) from (select teams.*,members.role,(select count(*) from lattice_private.members m where m.team_id=teams.id) as member_count from lattice_private.teams teams join lattice_private.members members on members.team_id=teams.id where members.user_id=u) q),'[]'),
      'skills',coalesce((select jsonb_agg(lattice_private.skill_json(sk) order by sk.updated_at desc) from lattice_private.skills sk where lattice_private.can_read(u,sk) and sk.status<>'archived'),'[]'),
      'connections',coalesce((select jsonb_agg(to_jsonb(c)-'token_hash'-'refresh_hash'-'client_id' order by c.created_at desc) from lattice_private.connections c where c.user_id=u and c.revoked_at is null),'[]')
    );
  elsif action='profile' then
    update lattice_private.profiles set name=trim(payload->>'name') where id=u;
    return jsonb_build_object('ok',true);
  elsif action='team_create' then
    if (select count(*) from lattice_private.teams where owner_id=u)>=10 then raise exception 'You can create up to 10 teams'; end if;
    insert into lattice_private.teams(name,owner_id) values(trim(payload->>'name'),u) returning id into t;
    insert into lattice_private.members(team_id,user_id,role) values(t,u,'owner');
    return jsonb_build_object('id',t);
  elsif action='team_details' then
    t:=(payload->>'id')::uuid;
    if not lattice_private.is_member(u,t) then raise exception 'Team not found' using errcode='42501'; end if;
    return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.name,'role',m.role,'joined_at',m.joined_at)) from lattice_private.members m join lattice_private.profiles p on p.id=m.user_id where m.team_id=t),'[]'),
    'invites',case when lattice_private.is_owner(u,t) then coalesce((select jsonb_agg(to_jsonb(i)-'token_hash') from lattice_private.invites i where i.team_id=t and i.revoked_at is null and i.accepted_by is null and i.expires_at>now()),'[]') else '[]' end);
  elsif action='team_rename' then
    t:=(payload->>'id')::uuid;
    if not lattice_private.is_owner(u,t) then raise exception 'Only the owner can rename this team' using errcode='42501'; end if;
    update lattice_private.teams set name=trim(payload->>'name') where id=t;
    return jsonb_build_object('ok',true);
  elsif action='member_remove' or action='team_leave' then
    t:=(payload->>'team_id')::uuid; target:=case when action='team_leave' then u else (payload->>'user_id')::uuid end;
    if not lattice_private.is_member(u,t) or (target<>u and not lattice_private.is_owner(u,t)) then raise exception 'Not allowed' using errcode='42501'; end if;
    if lattice_private.is_owner(target,t) then raise exception 'The team owner cannot be removed'; end if;
    delete from lattice_private.members where team_id=t and user_id=target;
    update lattice_private.skills set team_id=null,updated_at=now() where team_id=t and author_id=target;
    return jsonb_build_object('ok',true);
  elsif action='invite_create' then
    t:=(payload->>'team_id')::uuid;
    if not lattice_private.is_owner(u,t) then raise exception 'Only the team owner can invite members' using errcode='42501'; end if;
    if (select count(*) from lattice_private.invites where team_id=t and created_at>now()-interval '1 day')>=50 then raise exception 'Daily invite limit reached'; end if;
    raw_token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into lattice_private.invites(team_id,created_by,token_hash,email) values(t,u,lattice_private.hash(raw_token),nullif(lower(trim(payload->>'email')),'')) returning id into target;
    return jsonb_build_object('id',target,'token',raw_token);
  elsif action='invite_revoke' then
    select * into inv from lattice_private.invites where id=(payload->>'id')::uuid for update;
    if inv.id is null or not lattice_private.is_owner(u,inv.team_id) then raise exception 'Invite not found' using errcode='42501'; end if;
    update lattice_private.invites set revoked_at=now() where id=inv.id;
    return jsonb_build_object('ok',true);
  elsif action='invite_preview' or action='invite_accept' then
    select * into inv from lattice_private.invites where token_hash=lattice_private.hash(payload->>'token') for update;
    if inv.id is null or inv.revoked_at is not null or inv.expires_at<=now() or (inv.accepted_by is not null and inv.accepted_by<>u) then raise exception 'This invite has expired, was revoked, or has already been used'; end if;
    if inv.email is not null and inv.email<>lower(email_address) then raise exception 'Sign in with the email address this invite was created for' using errcode='42501'; end if;
    select name into team_name from lattice_private.teams where id=inv.team_id;
    if action='invite_accept' then
      insert into lattice_private.members(team_id,user_id,role) values(inv.team_id,u,'member') on conflict do nothing;
      update lattice_private.invites set accepted_by=u where id=inv.id;
    end if;
    return jsonb_build_object('team_id',inv.team_id,'team_name',team_name,'expires_at',inv.expires_at);
  elsif action='skill_create' then
    if (select count(*) from lattice_private.skills where author_id=u and created_at>now()-interval '1 day')>=200 then raise exception 'Daily skill limit reached'; end if;
    insert into lattice_private.skills(author_id,title,description,method,category) values(u,trim(payload->>'title'),coalesce(payload->>'description',''),trim(payload->>'method'),coalesce(payload->>'category','Engineering')) returning * into s;
    return lattice_private.skill_json(s);
  elsif action in ('skill_update','skill_approve','skill_archive','skill_share') then
    select * into s from lattice_private.skills where id=(payload->>'id')::uuid for update;
    if s.id is null or s.author_id<>u then raise exception 'Only the author can change this skill' using errcode='42501'; end if;
    if action='skill_update' then
      update lattice_private.skills set title=trim(payload->>'title'),description=coalesce(payload->>'description',''),method=trim(payload->>'method'),category=coalesce(payload->>'category','Engineering'),status='draft',team_id=null,approved_at=null,approval_hash=null,version=version+1,updated_at=now() where id=s.id returning * into s;
    elsif action='skill_archive' then
      update lattice_private.skills set status='archived',team_id=null,approval_hash=null,updated_at=now() where id=s.id returning * into s;
    else
      if action='skill_share' and s.status<>'approved' then raise exception 'Approve the method before sharing it'; end if;
      t:=nullif(payload->>'team_id','')::uuid;
      if t is not null and not lattice_private.is_member(u,t) then raise exception 'Join this team before sharing' using errcode='42501'; end if;
      update lattice_private.skills set status='approved',team_id=t,approved_at=coalesce(approved_at,now()),approval_hash=null,updated_at=now() where id=s.id returning * into s;
      insert into lattice_private.events(user_id,team_id,skill_id,action) values(u,t,s.id,action);
    end if;
    return lattice_private.skill_json(s);
  elsif action='skill_borrow' then
    select * into s from lattice_private.skills where id=(payload->>'id')::uuid;
    if s.id is null or s.status<>'approved' or not lattice_private.can_read(u,s) then raise exception 'Skill not available' using errcode='42501'; end if;
    insert into lattice_private.events(user_id,team_id,skill_id,action) values(u,s.team_id,s.id,'borrow');
    return lattice_private.skill_json(s);
  elsif action='connection_create' then
    if (select count(*) from lattice_private.connections where user_id=u and revoked_at is null)>=20 then raise exception 'Revoke an old connection before adding another'; end if;
    raw_token:='lattice_'||encode(extensions.gen_random_bytes(32),'hex');
    insert into lattice_private.connections(user_id,name,token_hash,expires_at) values(u,coalesce(nullif(trim(payload->>'name'),''),'Codex'),lattice_private.hash(raw_token),now()+interval '90 days') returning id into target;
    return jsonb_build_object('id',target,'token',raw_token,'expires_in_days',90);
  elsif action='connection_revoke' then
    update lattice_private.connections set revoked_at=now() where id=(payload->>'id')::uuid and user_id=u;
    return jsonb_build_object('ok',true);
  elsif action='oauth_authorize' then
    if payload->>'challenge' is null or (payload->>'challenge') !~ '^[A-Za-z0-9_-]{43}$' or payload->>'client_id' is null or payload->>'redirect_uri' is null or payload->>'resource' is null or length(payload->>'client_id')>5000 or length(payload->>'redirect_uri')>2000 then raise exception 'Invalid authorization request'; end if;
    if (select count(*) from lattice_private.oauth_codes where user_id=u and expires_at>now())>=20 then raise exception 'Too many authorization attempts'; end if;
    delete from lattice_private.oauth_codes where expires_at<now();
    code:=encode(extensions.gen_random_bytes(32),'hex');
    insert into lattice_private.oauth_codes(code_hash,user_id,client_id,client_name,redirect_uri,challenge,resource) values(lattice_private.hash(code),u,payload->>'client_id',left(payload->>'client_name',100),payload->>'redirect_uri',payload->>'challenge',payload->>'resource');
    return jsonb_build_object('code',code);
  else raise exception 'Unknown action';
  end if;
end;
$$;

create function public.lattice_agent(access_token text,action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c lattice_private.connections; u uuid; s lattice_private.skills; t uuid; nonce text;
begin
  select * into c from lattice_private.connections where token_hash=lattice_private.hash(access_token) and revoked_at is null and expires_at>now();
  if c.id is null then raise exception 'Invalid or expired Lattice connection' using errcode='42501'; end if;
  u:=c.user_id;
  if (select count(*) from lattice_private.events ev where ev.user_id=u and ev.created_at>now()-interval '1 minute' and ev.action='mcp_call')>=120 then raise exception 'Rate limit reached. Try again in a minute'; end if;
  insert into lattice_private.events(user_id,action) values(u,'mcp_call');
  update lattice_private.connections set last_used_at=now() where id=c.id;
  if action='context' then
    return jsonb_build_object('user_id',u,'name',(select name from lattice_private.profiles where id=u),'teams',coalesce((select jsonb_agg(jsonb_build_object('id',teams.id,'name',teams.name)) from lattice_private.teams teams join lattice_private.members m on m.team_id=teams.id where m.user_id=u),'[]'));
  elsif action='list' then
    return coalesce((select jsonb_agg(lattice_private.skill_json(sk)) from (select sk.* from lattice_private.skills sk where sk.status='approved' and lattice_private.can_read(u,sk) and (nullif(payload->>'query','') is null or sk.title ilike '%'||(payload->>'query')||'%' or sk.description ilike '%'||(payload->>'query')||'%') order by sk.updated_at desc limit 100) sk),'[]');
  elsif action='get' then
    select * into s from lattice_private.skills where id=(payload->>'id')::uuid;
    if s.id is null or not lattice_private.can_read(u,s) then raise exception 'Skill not available' using errcode='42501'; end if;
    return lattice_private.skill_json(s);
  elsif action='propose' then
    if (select count(*) from lattice_private.skills where author_id=u and created_at>now()-interval '1 day')>=200 then raise exception 'Daily skill limit reached'; end if;
    nonce:=encode(extensions.gen_random_bytes(32),'hex');
    insert into lattice_private.skills(author_id,title,description,method,category,source,approval_hash) values(u,trim(payload->>'title'),coalesce(payload->>'description',''),trim(payload->>'method'),coalesce(payload->>'category','Engineering'),'codex',lattice_private.hash(nonce)) returning * into s;
    return jsonb_build_object('skill',lattice_private.skill_json(s),'approval_nonce',nonce);
  elsif action='approve' then
    select * into s from lattice_private.skills where id=(payload->>'id')::uuid for update;
    if s.id is null or s.author_id<>u or s.status<>'draft' or s.approval_hash is null or s.approval_hash is distinct from lattice_private.hash(payload->>'approval_nonce') then raise exception 'Approval expired. Review this skill in Lattice' using errcode='42501'; end if;
    t:=nullif(payload->>'team_id','')::uuid;
    if t is not null and not lattice_private.is_member(u,t) then raise exception 'You are not a member of this team' using errcode='42501'; end if;
    update lattice_private.skills set status='approved',team_id=t,approved_at=now(),approval_hash=null,updated_at=now() where id=s.id returning * into s;
    insert into lattice_private.events(user_id,team_id,skill_id,action) values(u,t,s.id,'inline_approve');
    return lattice_private.skill_json(s);
  elsif action='borrow' then
    select * into s from lattice_private.skills where id=(payload->>'id')::uuid;
    if s.id is null or s.status<>'approved' or not lattice_private.can_read(u,s) then raise exception 'Skill not available' using errcode='42501'; end if;
    insert into lattice_private.events(user_id,team_id,skill_id,action) values(u,s.team_id,s.id,'borrow');
    return lattice_private.skill_json(s);
  else raise exception 'Unknown agent action'; end if;
end;
$$;

create function public.lattice_oauth_exchange(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare grant_row lattice_private.oauth_codes; conn lattice_private.connections; token text; refresh text; uid uuid; client text; label text; computed_challenge text;
begin
  if payload->>'grant_type'='authorization_code' then
    select * into grant_row from lattice_private.oauth_codes where code_hash=lattice_private.hash(payload->>'code') for update;
    if grant_row.code_hash is null or grant_row.expires_at<=now() or grant_row.client_id is distinct from payload->>'client_id' or grant_row.redirect_uri is distinct from payload->>'redirect_uri' or grant_row.resource is distinct from payload->>'resource' then raise exception 'Invalid authorization grant' using errcode='42501'; end if;
    if payload->>'code_verifier' is null or length(payload->>'code_verifier') not between 43 and 128 then raise exception 'Invalid code verifier' using errcode='42501'; end if;
    computed_challenge:=rtrim(translate(encode(extensions.digest(payload->>'code_verifier','sha256'),'base64'),'+/','-_'),'=');
    if computed_challenge is distinct from grant_row.challenge then raise exception 'Invalid code verifier' using errcode='42501'; end if;
    uid:=grant_row.user_id;client:=grant_row.client_id;label:=grant_row.client_name;
    delete from lattice_private.oauth_codes where code_hash=grant_row.code_hash;
  elsif payload->>'grant_type'='refresh_token' then
    select * into conn from lattice_private.connections where refresh_hash=lattice_private.hash(payload->>'refresh_token') for update;
    if conn.id is null or conn.revoked_at is not null or conn.refresh_expires_at<=now() or conn.client_id is distinct from payload->>'client_id' then raise exception 'Invalid refresh token' using errcode='42501'; end if;
    uid:=conn.user_id;client:=conn.client_id;label:=conn.name;
    update lattice_private.connections set revoked_at=now() where id=conn.id;
  else raise exception 'Unsupported grant type'; end if;
  if (select count(*) from lattice_private.connections where user_id=uid and revoked_at is null)>=20 then raise exception 'Connection limit reached. Revoke an old connection in Lattice'; end if;
  token:='lattice_'||encode(extensions.gen_random_bytes(32),'hex');refresh:=encode(extensions.gen_random_bytes(32),'hex');
  insert into lattice_private.connections(user_id,name,token_hash,refresh_hash,client_id,expires_at,refresh_expires_at) values(uid,label,lattice_private.hash(token),lattice_private.hash(refresh),client,now()+interval '1 hour',now()+interval '30 days');
  return jsonb_build_object('access_token',token,'refresh_token',refresh,'token_type','Bearer','expires_in',3600,'scope','skills:read skills:write');
end;
$$;
revoke all on all functions in schema lattice_private from public,anon,authenticated;
revoke all on function public.lattice_web(text,jsonb) from public,anon;
grant execute on function public.lattice_web(text,jsonb) to authenticated;
revoke all on function public.lattice_agent(text,text,jsonb) from public;
grant execute on function public.lattice_agent(text,text,jsonb) to anon,authenticated;
revoke all on function public.lattice_oauth_exchange(jsonb) from public;
grant execute on function public.lattice_oauth_exchange(jsonb) to anon;
