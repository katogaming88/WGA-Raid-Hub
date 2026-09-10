// The people a restored snapshot can be signed in as (#1065).
//
// `npm run db:snapshot` leaves production data with every link into auth.users
// nulled and no accounts at all, so without this the only sign-in is a real
// person's Discord id. This batch mints, from the teams table, an officer, a
// team leader and a raider per team plus admin, guild-officer and boe-manager.
// Each is an account the auth service will issue a link for, an identity, and
// a grant row bound to it in the same statement. Every policy reads
// auth_user_id = auth.uid() and nothing else, so to RLS a persona's row is
// exactly what a real officer's row is: a genuine grant, not impersonation.
//
// The seed names its six people the same way by hand (phoenix-officer,
// hellfire-officer, ...), so one name means one person on either stack, and
// tests/rls/seed-personas.test.js keeps the seed on this scheme.
//
// Discord ids are 20 digits starting with 9. A snowflake is an unsigned 64-bit
// integer, so no real id can exceed 18446744073709551615 and these are outside
// the space for good; the unique constraints on discord_id turn any collision
// into a loud insert failure rather than a silent bind to a stranger's row.
//
// Each raider owns a character, <Team>raider-Persona, because the profile page
// resolves the signed-in character through players.team_member_id and a raider
// with none is offered the real unclaimed characters to claim. Officers and
// leaders get none, as in the seed.
//
// Run as one psql -c batch inside --single-transaction; the temp table is the
// one place the naming lives. tests/rls/snapshot-personas.test.js runs it
// against the seeded stack, and tests/ci/db-snapshot.test.js pins its shape.
export const PERSONAS_SQL = `
create temp table persona on commit drop as
with team_rows as (
  select t.id as team_id,
         t.slug,
         r.role,
         t.slug || '-' || r.short as name,
         null::text as tier,
         r.code
    from public.teams t
   cross join (values ('officer', 'officer', 1), ('team_leader', 'leader', 2), ('raider', 'raider', 3))
           as r(role, short, code)
),
guild_rows as (
  select null::integer as team_id,
         null::text as slug,
         null::text as role,
         g.name,
         g.tier,
         g.code
    from (values ('admin', 'site_admins', 1), ('guild-officer', 'guild_officers', 2), ('boe-manager', 'boe_managers', 3))
           as g(name, tier, code)
)
select team_id, slug, role, name, tier, code,
       '9000000000000000' || lpad(coalesce(team_id, 0)::text, 3, '0') || code::text as discord_id,
       (case when team_id is null then '00000000-0000-0000-0002-' else '00000000-0000-0000-0001-' end
         || lpad(coalesce(team_id, 0)::text, 9, '0') || lpad(code::text, 3, '0'))::uuid as user_id
  from (select * from team_rows union all select * from guild_rows) as all_rows;

do $$
begin
  if exists (select 1 from persona where name !~ '^[a-z0-9-]+$') then
    raise exception 'a team slug is not a valid address local part: %',
      (select string_agg(name, ', ') from persona where name !~ '^[a-z0-9-]+$');
  end if;
  if exists (select 1 from persona where length(discord_id) <> 20) then
    raise exception 'a persona id is not 20 digits; is there a team id past 999?';
  end if;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000',
       p.user_id,
       'authenticated',
       'authenticated',
       p.name || '@wga.local',
       '',
       now(),
       '', '', '', '',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('provider_id', p.discord_id, 'full_name', initcap(replace(p.name, '-', ' '))),
       now(),
       now()
  from persona p;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select p.discord_id,
       p.user_id,
       jsonb_build_object('sub', p.user_id::text, 'email', p.name || '@wga.local', 'provider_id', p.discord_id),
       'email',
       now(),
       now(),
       now()
  from persona p;

insert into public.team_members (team_id, discord_id, auth_user_id, role)
select team_id, discord_id, user_id, role from persona where team_id is not null;

insert into public.site_admins (discord_id, auth_user_id)
select discord_id, user_id from persona where tier = 'site_admins';

insert into public.guild_officers (discord_id, auth_user_id)
select discord_id, user_id from persona where tier = 'guild_officers';

insert into public.boe_managers (discord_id, auth_user_id)
select discord_id, user_id from persona where tier = 'boe_managers';

insert into public.players (team_id, name_realm, class_spec_id, team_member_id)
select p.team_id,
       initcap(regexp_replace(p.slug, '[^a-z0-9]', '', 'g')) || 'raider-Persona',
       (select min(id) from public.classes_specs),
       tm.id
  from persona p
  join public.team_members tm on tm.team_id = p.team_id and tm.discord_id = p.discord_id
 where p.role = 'raider';

select name as persona from persona order by team_id nulls last, name;
`;
