export function neonMigration(source){
  return `create schema if not exists extensions;
create schema if not exists auth;
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end$$;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
revoke all on schema auth from public;
`+source.replaceAll('auth.users','neon_auth."user"')
    .replace('email_confirmed_at is not null','"emailVerified"=true')
    .replace("raw_user_meta_data->>'name'","name")+`
create table lattice_private.auth_limits(key text primary key,attempts int not null default 1,expires_at timestamptz not null);
create index auth_limits_expiry on lattice_private.auth_limits(expires_at);
alter table lattice_private.auth_limits enable row level security;
revoke all on lattice_private.auth_limits from public,anon,authenticated;
`;
}
