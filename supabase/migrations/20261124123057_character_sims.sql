-- #1443 (part 1 of 2): raiders' droptimizer sims. A raider, or an officer
-- who manages the team's loot, pastes a Raidbots droptimizer or QE Live
-- upgrade report link on the raider's profile. The page reads the report
-- (both sites let a browser read it) and sends each result here.
--
-- One sim per character per difficulty: a new one replaces the old (Kat,
-- 2026-11-24), so what officers see is always the latest. #1888's named
-- setups may widen this later. A QE Live report covering two difficulties
-- is saved as two sims.
--
-- Every result is kept (Viserio's lesson): a ring, trinket or weapon simmed
-- into each slot it fits is one row per slot, and QE Live's "as it drops"
-- and "fully upgraded" levels are one row each. The page shows the fully
-- upgraded one (Kat, 2026-11-24); #1888's upgrade level setting can choose
-- another later. A tier piece made at the catalyst names the item it came
-- from (catalyst_from), so a token can show what it becomes (#1443 part 2).
--
-- When a sim goes out of date is the team's setting, simStaleDays in
-- team_settings.config (default 14), read by the app; nothing here expires.
--
-- Anyone can read sims, like the rest of a profile. Nobody writes the tables
-- directly: save_character_sim() and delete_character_sim() do, for the
-- character's own raider, an officer with manage_loot (but not on the team
-- leader's character, CodeRabbit on PR #1914), or a site admin. A raider's
-- own change writes its audit row itself, since write_audit_log() refuses
-- raiders (set_own_missing_spec() does the same); anyone else's goes through
-- write_audit_log().

create table public.character_sims (
  id bigint generated always as identity primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  player_id integer not null references public.players(id) on delete cascade,
  difficulty text not null check (difficulty in ('lfr', 'normal', 'heroic', 'mythic')),
  source text not null check (source in ('raidbots', 'qe_live')),
  report_id text not null check (report_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  simmed_at timestamp with time zone not null,
  fight_style text check (char_length(fight_style) <= 40),
  target_count integer check (target_count between 1 and 100),
  added_by integer references public.people(id) on delete set null,
  added_at timestamp with time zone not null default now(),
  unique (player_id, difficulty)
);

create index character_sims_team_id_idx on public.character_sims (team_id);

comment on table public.character_sims is
  'A raider''s latest droptimizer sim per difficulty (#1443): Raidbots or QE Live, written by save_character_sim().';

create table public.character_sim_results (
  id bigint generated always as identity primary key,
  sim_id bigint not null references public.character_sims(id) on delete cascade,
  wow_item_id integer not null check (wow_item_id > 0),
  item_name text check (char_length(item_name) <= 200),
  slot text check (char_length(slot) <= 20),
  item_level integer not null check (item_level between 1 and 2000),
  pct_gain numeric not null,
  dps_gain numeric,
  encounter_id integer,
  catalyst_from integer check (catalyst_from > 0)
);

create index character_sim_results_sim_id_idx on public.character_sim_results (sim_id);

comment on table public.character_sim_results is
  'Each result in a sim (#1443): the item, the slot simmed into (Raidbots only), its item level and the gain in percent (and DPS for Raidbots).';

alter table public.character_sims enable row level security;
alter table public.character_sim_results enable row level security;

create policy "Anyone reads character_sims" on public.character_sims for select using (true);
create policy "Anyone reads character_sim_results" on public.character_sim_results for select using (true);

revoke all on table public.character_sims from public, anon, authenticated, service_role;
revoke all on table public.character_sim_results from public, anon, authenticated, service_role;
grant select on table public.character_sims to anon, authenticated, service_role;
grant select on table public.character_sim_results to anon, authenticated, service_role;

-- Saves a sim for one character at one difficulty, replacing the one there.
-- The raider themself, an officer with manage_loot on the character's team,
-- or a site admin. p_results is a list of
-- {wow_item_id, item_name, slot, item_level, pct_gain, dps_gain,
--  encounter_id, catalyst_from}; returns how many were saved.
create function public.save_character_sim(
  p_player_id integer,
  p_difficulty text,
  p_source text,
  p_report_id text,
  p_simmed_at timestamp with time zone,
  p_fight_style text,
  p_target_count integer,
  p_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
  v_sim_id bigint;
  v_count integer;
  v_leader boolean;
  v_own boolean;
  v_detail jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select p.team_id, coalesce(tm.role = 'team_leader', false) into v_team_id, v_leader
    from public.players p
    left join public.team_members tm on tm.id = p.team_member_id and tm.archived_at is null
   where p.id = p_player_id and p.archived_at is null;
  v_own := coalesce(public.is_own_player(p_player_id), false);
  if v_team_id is null
     or not (v_own
             or (public.has_team_permission(v_team_id, 'manage_loot') and not v_leader)
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if jsonb_typeof(p_results) is distinct from 'array'
     or jsonb_array_length(p_results) = 0 then
    raise exception 'The sim has no results.';
  end if;
  if jsonb_array_length(p_results) > 2000 then
    raise exception 'The sim has too many results.';
  end if;
  if p_simmed_at > now() + interval '1 day' then
    raise exception 'The sim''s date is in the future.';
  end if;

  insert into public.character_sims
    (team_id, player_id, difficulty, source, report_id, simmed_at, fight_style, target_count, added_by)
  values
    (v_team_id, p_player_id, p_difficulty, p_source, p_report_id, p_simmed_at,
     nullif(trim(p_fight_style), ''), p_target_count, public.my_person_id())
  on conflict (player_id, difficulty) do update
     set source = excluded.source,
         report_id = excluded.report_id,
         simmed_at = excluded.simmed_at,
         fight_style = excluded.fight_style,
         target_count = excluded.target_count,
         added_by = excluded.added_by,
         added_at = now()
  returning id into v_sim_id;

  delete from public.character_sim_results where sim_id = v_sim_id;

  insert into public.character_sim_results
    (sim_id, wow_item_id, item_name, slot, item_level, pct_gain, dps_gain, encounter_id, catalyst_from)
  select v_sim_id, r.wow_item_id, nullif(trim(r.item_name), ''), nullif(trim(r.slot), ''),
         r.item_level, r.pct_gain, r.dps_gain, r.encounter_id, r.catalyst_from
    from jsonb_to_recordset(p_results) as r(
           wow_item_id integer, item_name text, slot text, item_level integer,
           pct_gain numeric, dps_gain numeric, encounter_id integer, catalyst_from integer);
  get diagnostics v_count = row_count;

  v_detail := jsonb_build_object('summary', initcap(p_difficulty) || ' sim from '
    || case p_source when 'raidbots' then 'Raidbots' else 'QE Live' end
    || ', ' || v_count || ' results');
  if v_own then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (v_team_id, auth.uid(), 'Sim Added', 'players', p_player_id, v_detail);
  else
    perform public.write_audit_log(v_team_id, 'Sim Added', 'players', p_player_id, v_detail);
  end if;
  return v_count;
end;
$$;

comment on function public.save_character_sim(integer, text, text, text, timestamp with time zone, text, integer, jsonb) is
  'Saves a raider''s sim at one difficulty, replacing the one there (#1443). The raider, an officer with manage_loot (not on the team leader''s character), or a site admin.';

-- Removes a character's sim at one difficulty. Same people as saving.
create function public.delete_character_sim(p_player_id integer, p_difficulty text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
  v_leader boolean;
  v_own boolean;
  v_detail jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select p.team_id, coalesce(tm.role = 'team_leader', false) into v_team_id, v_leader
    from public.players p
    left join public.team_members tm on tm.id = p.team_member_id and tm.archived_at is null
   where p.id = p_player_id;
  v_own := coalesce(public.is_own_player(p_player_id), false);
  if v_team_id is null
     or not (v_own
             or (public.has_team_permission(v_team_id, 'manage_loot') and not v_leader)
             or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from public.character_sims where player_id = p_player_id and difficulty = p_difficulty;
  if found then
    v_detail := jsonb_build_object('summary', initcap(p_difficulty) || ' sim removed');
    if v_own then
      insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
      values (v_team_id, auth.uid(), 'Sim Removed', 'players', p_player_id, v_detail);
    else
      perform public.write_audit_log(v_team_id, 'Sim Removed', 'players', p_player_id, v_detail);
    end if;
  end if;
end;
$$;

comment on function public.delete_character_sim(integer, text) is
  'Removes a raider''s sim at one difficulty (#1443). The raider, an officer with manage_loot (not on the team leader''s character), or a site admin.';

revoke all on function public.save_character_sim(integer, text, text, text, timestamp with time zone, text, integer, jsonb) from public, anon;
revoke all on function public.delete_character_sim(integer, text) from public, anon;
grant execute on function public.save_character_sim(integer, text, text, text, timestamp with time zone, text, integer, jsonb) to authenticated, service_role;
grant execute on function public.delete_character_sim(integer, text) to authenticated, service_role;
