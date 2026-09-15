-- #942 step 5 (part a), #1162: a person's characters from their Battle.net account.
--
-- The new app signs in with Battle.net, and the Battle.net token can read the
-- account's World of Warcraft characters. This is the storage and the two
-- writes the battlenet-characters Edge Function makes with that list. Nothing
-- in the browser writes here: the function reads the list from Blizzard itself
-- and checks the token belongs to the Battle.net login linked to the caller.
--
-- Kat's calls (2026-09-15):
--   - A raider picks which of their characters to show as alts. Only what they
--     pick is saved (characters). An alt is a character listed on the person,
--     not a roster row (#942, 2026-09-14): no attendance, priority or loot.
--   - A character on the list that is on a team's roster and unclaimed is
--     linked to them automatically, the way claim_character() links one they
--     pick from the dropdown today. Blizzard's list is the proof of ownership.
--   - The any-time main swap request (#631) is its own change, next.
--
-- A membership still needs a Discord id until cutover (team_members.discord_id,
-- step 6), so a person with no Discord linked is told to connect it rather
-- than linked.

create table public.characters (
  id integer generated always as identity primary key,
  person_id integer not null references public.people (id) on delete cascade,
  blizzard_id bigint not null,
  name text not null,
  realm text not null,
  realm_slug text not null,
  name_realm text generated always as (name || '-' || realm) stored,
  name_realm_key text generated always as (lower(replace(name || '-' || realm, ' ', ''))) stored,
  class_name text,
  spec_name text,
  level integer,
  item_level integer,
  saved_at timestamp with time zone not null default now(),
  constraint characters_blizzard_id_key unique (blizzard_id)
);

comment on table public.characters is
  'Characters a person chose to show from their Battle.net account (#942 step 5, #1162). Written only by save_battlenet_characters() from the battlenet-characters Edge Function. A character here is an alt unless the same name_realm_key is a roster row linked to the person.';

create index characters_person_id_idx on public.characters (person_id);

alter table public.characters enable row level security;

-- Who reads a person's characters: the person, and whoever reads the person
-- (20260915161042_person_predicates.sql): an officer or team leader of a team
-- they are on, a site admin, a guild officer. Whether alts show on public pages
-- is decided with the roster and profile screens (#870, #1102).
create policy "People read own characters" on public.characters
  for select using (person_id = (select public.my_person_id()));

create policy "Officers read characters on their teams" on public.characters
  for select using (
    person_id in (
      select tm.person_id
        from public.team_members tm
       where tm.team_id = any ((select public.my_officer_team_ids())::integer[])
    )
    or (select public.is_site_admin())
    or (select public.is_guild_officer())
  );

create policy "Claude readers read characters" on public.characters
  for select to claude_readers using (true);

-- The Battle.net account id of the Battle.net login linked to an account, for
-- the function's check that a token belongs to the caller. Read here rather
-- than in the function, which never reads identity ids itself.
create or replace function public.battlenet_account_id(p_auth_user_id uuid) returns text
language sql stable security definer set search_path to 'public'
as $$
  select i.provider_id
    from auth.identities i
   where i.user_id = p_auth_user_id
     and i.provider = 'custom:battlenet';
$$;

revoke all on function public.battlenet_account_id(uuid) from public, anon, authenticated;
grant execute on function public.battlenet_account_id(uuid) to service_role;

-- Link the roster characters on a person's Battle.net list.
--
-- p_characters is [{ "name": ..., "realm": ... }], every character on the list
-- (not only the picked ones). Each active roster row whose name_realm_key
-- matches comes back with what happened to it:
--   linked                  unclaimed, now linked to the person
--   already_yours           already linked to one of the person's memberships
--   claimed_by_someone_else linked to another person; left alone for an officer
--   needs_discord           unclaimed, but the person has no Discord id yet
create or replace function public.link_battlenet_roster_characters(p_person_id integer, p_characters jsonb)
returns table(player_id integer, team_id integer, name_realm text, outcome text)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_discord_id text;
  v_row record;
  v_member_id integer;
begin
  select discord_id into v_discord_id from people where id = p_person_id;
  if not found then
    raise exception 'No person with id %', p_person_id;
  end if;

  for v_row in
    select p.id, p.team_id, p.name_realm, p.team_member_id, tm.person_id as holder
      from players p
      left join team_members tm on tm.id = p.team_member_id
     where p.archived_at is null
       and p.name_realm_key in (
         select lower(replace((c ->> 'name') || '-' || (c ->> 'realm'), ' ', ''))
           from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) c
       )
     order by p.team_id, p.name_realm
  loop
    player_id := v_row.id;
    team_id := v_row.team_id;
    name_realm := v_row.name_realm;

    if v_row.team_member_id is not null then
      outcome := case when v_row.holder = p_person_id then 'already_yours' else 'claimed_by_someone_else' end;
      return next;
      continue;
    end if;

    select tm.id into v_member_id
      from team_members tm
     where tm.team_id = v_row.team_id and tm.person_id = p_person_id;

    if v_member_id is null then
      if v_discord_id is null then
        outcome := 'needs_discord';
        return next;
        continue;
      end if;
      insert into team_members (team_id, discord_id, role)
      values (v_row.team_id, v_discord_id, 'raider')
      returning id into v_member_id;
    end if;

    -- The same guard claim_character() rides on: the write only lands on a row
    -- still unclaimed, so a claim racing this one cannot be overwritten.
    update players set team_member_id = v_member_id
     where id = v_row.id and team_member_id is null;

    outcome := case when found then 'linked' else 'claimed_by_someone_else' end;
    return next;
  end loop;
end;
$function$;

revoke all on function public.link_battlenet_roster_characters(integer, jsonb) from public, anon, authenticated;
grant execute on function public.link_battlenet_roster_characters(integer, jsonb) to service_role;

-- Replace the person's saved characters with the ones they picked.
--
-- p_characters is the picked characters as the function read them from
-- Blizzard: [{ blizzard_id, name, realm, realm_slug, class_name, spec_name,
-- level, item_level }]. A character saved by another person moves to this one:
-- the token has just shown it is on this person's Battle.net account now.
create or replace function public.save_battlenet_characters(p_person_id integer, p_characters jsonb)
returns setof public.characters
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from people where id = p_person_id) then
    raise exception 'No person with id %', p_person_id;
  end if;

  delete from characters c
   where c.person_id = p_person_id
     and c.blizzard_id not in (
       select (x ->> 'blizzard_id')::bigint from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
     );

  insert into characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
  select p_person_id,
         (x ->> 'blizzard_id')::bigint,
         x ->> 'name',
         x ->> 'realm',
         x ->> 'realm_slug',
         x ->> 'class_name',
         x ->> 'spec_name',
         (x ->> 'level')::integer,
         (x ->> 'item_level')::integer
    from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
  on conflict (blizzard_id) do update
    set person_id = excluded.person_id,
        name = excluded.name,
        realm = excluded.realm,
        realm_slug = excluded.realm_slug,
        class_name = excluded.class_name,
        spec_name = excluded.spec_name,
        level = excluded.level,
        item_level = excluded.item_level,
        saved_at = now();

  return query select * from characters where person_id = p_person_id order by name, realm;
end;
$function$;

revoke all on function public.save_battlenet_characters(integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_battlenet_characters(integer, jsonb) to service_role;
