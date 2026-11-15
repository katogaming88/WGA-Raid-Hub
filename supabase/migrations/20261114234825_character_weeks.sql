-- #1635: the roster audit's weekly row (#1261): one row per character per
-- week, decided on #1261 (2026-10-24).
--
-- * Per character, keyed on name_realm_key (players' and characters' own
--   generated key), so a raider on two teams is stored once and a roster
--   character whose person never imported from Battle.net is covered.
-- * A week is named by its reset date, the Tuesday it starts (week_of).
--   Blizzard's weekly period number is worked out from it where needed.
-- * Each sync updates the current week's row; after the reset a new row
--   starts and last week's stays as last written.
-- * It holds raid kills, M+ runs and rating, delves by tier, crests earned per
--   type, the Great Vault slots, and the gear counts at the week's last sync,
--   each part with when it was last written (a part never synced is null).
--   The addon's columns (#1440) join this row later.
--
-- Who reads it: anyone on a team the character is rostered on (the audit is
-- a team page), the character's owner, a guild rank with See every team on
-- that team, and site admins. Only the syncs write it (service_role).

create table public.character_weeks (
  name_realm_key text not null check (name_realm_key ~ '\S' and name_realm_key = lower(replace(name_realm_key, ' ', ''))),
  week_of date not null check (extract(isodow from week_of) = 2),
  name_realm text not null check (name_realm ~ '\S'),
  -- [{"encounter_id": 3176, "difficulty": "mythic"}, ...]
  raid_kills jsonb not null default '[]' check (jsonb_typeof(raid_kills) = 'array'),
  raids_at timestamp with time zone,
  -- [{"dungeon_id": 503, "level": 12, "timed": true}, ...]
  mplus_runs jsonb not null default '[]' check (jsonb_typeof(mplus_runs) = 'array'),
  mplus_rating numeric(6, 1) check (mplus_rating >= 0),
  mplus_at timestamp with time zone,
  -- {"8": 4, "11": 2}: delves done this week by tier
  delves jsonb not null default '{}' check (jsonb_typeof(delves) = 'object'),
  delves_at timestamp with time zone,
  -- {"Myth": 180, "Hero": 90}: crests earned this season, by season_crests.track
  crests jsonb not null default '{}' check (jsonb_typeof(crests) = 'object'),
  crests_at timestamp with time zone,
  -- the Great Vault's slots, as #1637 works them out
  vault jsonb not null default '{}' check (jsonb_typeof(vault) = 'object'),
  vault_at timestamp with time zone,
  missing_enchants smallint check (missing_enchants >= 0),
  empty_sockets smallint check (empty_sockets >= 0),
  epic_gem boolean,
  embellishments smallint check (embellishments >= 0),
  sparks_used smallint check (sparks_used >= 0),
  gear_at timestamp with time zone,
  primary key (name_realm_key, week_of)
);

comment on table public.character_weeks is
  'The roster audit''s weekly row (#1635, #1261): one per character (name_realm_key, as on players and characters) per week (week_of, the reset Tuesday). Each sync updates the current week''s row; older weeks stay as last written. Each part carries when it was last written. Read by the character''s teams and owner; written only by the syncs.';
comment on column public.character_weeks.week_of is
  'The reset Tuesday the week starts on.';
comment on column public.character_weeks.crests is
  'Crests earned this season by track (season_crests.track), from the character statistics season_crests.statistic_id names.';
comment on column public.character_weeks.missing_enchants is
  'Gear counts at the week''s last gear sync (#1634): enchantable slots without a current-expansion enchant, empty sockets, whether an epic gem is worn, embellishments and sparks used.';

alter table public.character_weeks owner to postgres;
alter table public.character_weeks enable row level security;

-- The characters the caller may read in the audit, by name_realm_key: every
-- active roster character on a team they are an active member of or whose
-- guild lets their rank see every team, and their own characters (imported
-- from Battle.net, or a roster row of theirs). Security definer so the rule
-- below reads players and characters whatever their own rules say.
create function public.my_audit_character_keys()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct k.key), '{}')
    from (
      select p.name_realm_key as key
        from players p
       where p.archived_at is null
         and (p.team_id in (select tm.team_id from team_members tm
                             where tm.person_id = my_person_id() and tm.archived_at is null)
              or p.team_id = any (my_guild_permission_team_ids('view_every_team')))
      union all
      select c.name_realm_key from characters c where c.person_id = my_person_id()
      union all
      select p.name_realm_key from players p where p.id = any (my_player_ids())
    ) k
   where k.key is not null and auth.uid() is not null;
$$;

comment on function public.my_audit_character_keys() is
  'The name_realm_keys the caller may read in the roster audit (#1635): active roster characters on their own teams and on teams their guild rank sees, and their own characters. Empty when signed out.';

revoke all on function public.my_audit_character_keys() from public, anon;
grant execute on function public.my_audit_character_keys() to authenticated;

create policy "Claude readers read character_weeks" on public.character_weeks
  for select to claude_readers using (true);
create policy "Teams and owners read character_weeks" on public.character_weeks for select to authenticated
  using (name_realm_key = any ((select my_audit_character_keys())::text[]) or (select is_site_admin()));

-- Read only for the site; only the syncs (service_role) write.
revoke all on table public.character_weeks from public, anon, authenticated, service_role;
grant select on table public.character_weeks to authenticated;
grant select, insert, update on table public.character_weeks to service_role;
