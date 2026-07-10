-- Public signup form write path (#403).
--
-- season_signups had no INSERT path at all: the public form (js/signup.js)
-- has always written only to the GAS "Roster Responses" Sheet, which nothing
-- reads since the officer Signups/Pending Roster tabs switched to Supabase-only
-- reads in #328. Every signup submitted since then landed in a Sheet no
-- officer screen ever looks at again.
--
-- SECURITY DEFINER, granted to anon: unlike claim_character() (#212, requires
-- auth.uid()), this form runs for prospective recruits with no Discord session
-- at all, so anon must be able to call it directly. The signupsOpen check
-- below is the actual gate here -- season_signups deliberately grants anon
-- no direct table INSERT, so this function is the only write path.
-- No anti-spam token: GAS's submitSignup had no server-side gate whatsoever
-- (the sheet accepted anything), so this is already strictly tighter than the
-- status quo. Real rate-limiting is Phase 7 Edge Function work.
--
-- One spec is collected per submission (the character being registered).
-- class_spec_id/swap_class_spec_id both exist on season_signups so a
-- main-swap signup's spec lands in the column mapSignupRow()/add_signup_to_
-- roster() actually read for that case (swap_class_spec_id, per #328's
-- coalesce(swap_class_spec_id, class_spec_id)); a plain signup uses
-- class_spec_id. The officer manually picks which existing roster character
-- to archive at Add-to-Roster time (#328) -- this function has no concept of
-- "the old character", only whether a swap was requested.
create or replace function public.submit_season_signup(
  p_team_id integer,
  p_name_realm text,
  p_class text,
  p_spec text,
  p_off_specs text default '',
  p_main_swap boolean default false,
  p_player_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_class_spec_id integer;
  v_season text;
  v_signup_id integer;
begin
  select config into v_config from public.team_settings where team_id = p_team_id;
  if v_config is null or coalesce((v_config->>'signupsOpen')::boolean, false) is not true then
    raise exception 'signups are not open for this team';
  end if;
  v_season := v_config->>'activeSignupSeason';

  select id into v_class_spec_id from public.classes_specs
   where class = p_class and spec = p_spec;
  if not found then
    raise exception 'unknown class/spec: % / %', p_class, p_spec;
  end if;

  insert into public.season_signups (
    team_id, signup_name_realm, class_spec_id, off_specs, main_swap,
    swap_class_spec_id, player_note, season, status
  ) values (
    p_team_id, p_name_realm,
    case when p_main_swap then null else v_class_spec_id end,
    nullif(p_off_specs, ''), p_main_swap,
    case when p_main_swap then v_class_spec_id else null end,
    nullif(p_player_note, ''), v_season, 'pending'
  ) returning id into v_signup_id;

  return v_signup_id;
end $$;

revoke all on function public.submit_season_signup(integer, text, text, text, text, boolean, text)
  from public;
grant execute on function public.submit_season_signup(integer, text, text, text, text, boolean, text)
  to anon, authenticated;

-- One-time historical backfill (#403): Hellfire's GAS "Roster Responses" sheet
-- holds ~21 real MID2 signups that predate this write path and would
-- otherwise be permanently invisible to the officer Signups tab once the
-- Sheet is retired. Pulled via the same read-only getSignups GAS endpoint the
-- officer UI already calls. Phoenix's sheet holds only two June test rows and
-- is not backfilled. "Katorritest" (Hellfire, notes "test test test") is
-- excluded from Hellfire's backfill for the same reason.
--
-- Status resolution cross-checked against the live players table for team 2:
--   - Denied in the sheet -> 'rejected'.
--   - Approved and already has a matching players row -> 'added' with
--     approved_player_id set, so it reads as settled history, not a live
--     pending item.
--   - Approved with no matching players row -> 'approved' with
--     approved_player_id left null, so it surfaces in Pending Roster for an
--     officer to actually decide on. Two rows land here: Dhbruh-Dalaran
--     (flagged in #403) and Poplockndots-Thrall (found during this backfill,
--     not previously flagged) -- neither has ever been rostered or denied.
-- reviewed_at/reviewed_by are left null throughout: the sheet only ever
-- captured the submission timestamp, not when/who reviewed it.
insert into public.season_signups (
  team_id, signup_name_realm, class_spec_id, off_specs, main_swap,
  swap_class_spec_id, player_note, season, status, approved_player_id, submitted_at
)
select 2, v.name_realm,
       case when v.main_swap then null else cs.id end,
       nullif(v.off_specs, ''), v.main_swap,
       case when v.main_swap then cs.id else null end,
       nullif(v.notes, ''), 'Midnight Season 2', v.status,
       (select p.id from public.players p where p.team_id = 2 and lower(p.name_realm) = lower(v.name_realm)),
       timezone('America/New_York', v.submitted_at)
from (values
  ('Traintrack-Tichondrius',    'Monk',         'Brewmaster',    'Mistweaver',              false, null, 'added',    '2026-07-08 21:34'::timestamp),
  ('Puffd-Thrall',              'Evoker',       'Augmentation',  'Devastation, Preservation', false, 'im open to playing just about any class if someone else really wants the evo spot... ive played a disgusting amount of mage in my life, and feel comfortable doing whatever', 'added', '2026-07-08 18:55'::timestamp),
  ('Dhbruh-Dalaran',            'Demon Hunter', 'Devourer',      'Vengeance',               false, null, 'approved', '2026-07-08 18:12'::timestamp),
  ('Shifttease-Tichondrius',    'Druid',        'Balance',       'Restoration',             true,  'Going to play whatever m+ meta dps. Book it', 'added', '2026-07-07 13:28'::timestamp),
  ('Vellisara-Nesingwary',      'Hunter',       'Beast Mastery', null,                      true,  null, 'added',    '2026-07-07 12:08'::timestamp),
  ('Datdemondude-Tichondrius',  'Warlock',      'Demonology',    'Affliction',              false, 'I''m not necessarily playing lock. Train might be healing this season and I might be tanking... only if prot pally is the play.', 'added', '2026-07-07 12:01'::timestamp),
  ('Poplockndots-Thrall',       'Warlock',      'Demonology',    null,                      false, 'maining ranged i think either warlock or hunter...but still will have palyxwhacker if needed... Pretty much will play any spec needed other than healer', 'approved', '2026-07-05 10:42'::timestamp),
  ('Chickennuggs-Tichondrius',  'Druid',        'Feral',         'Balance',                 false, null, 'added',    '2026-06-30 20:15'::timestamp),
  ('Liquidsdaddy-Illidan',      'Warrior',      'Fury',          null,                      false, 'I Play havoc and bear. also play some unholy but mainly warrior', 'added', '2026-06-29 18:25'::timestamp),
  ('Humbledundle-Tichondrius',  'Mage',         'Frost',         'Fire',                    false, 'Happy to play warrior or shaman DPS if we require it.', 'added', '2026-06-29 17:10'::timestamp),
  ('Zartunie-Mal''Ganis',       'Shaman',       'Restoration',   'Elemental',               false, 'Sexy healz for days.', 'added', '2026-06-29 16:16'::timestamp),
  ('Aeglos-Argent Dawn',        'Death Knight', 'Frost',         'Unholy',                  false, 'I prefer Frost, but will play Unholy as needed.', 'added', '2026-06-29 15:16'::timestamp),
  ('Dayned-Dalaran',            'Druid',        'Restoration',   'Balance',                 true,  null, 'added',    '2026-06-29 13:40'::timestamp),
  ('Glizzygary-Dalaran',        'Monk',         'Windwalker',    null,                      false, null, 'added',    '2026-06-29 13:40'::timestamp),
  ('GLizzygary-Dalaran',        'Monk',         'Windwalker',    null,                      true,  null, 'added',    '2026-06-29 13:07'::timestamp),
  ('Simbra-Tichondrius',        'Rogue',        'Subtlety',      'Assassination, Outlaw',   false, 'Return of the king', 'added', '2026-06-29 11:48'::timestamp),
  ('Caèn-Tichondrius',          'Rogue',        'Subtlety',      'Outlaw',                  false, 'I had joined at the last 2 raids of Season 1. Have always been an m+ Andy playing with chicken, grip, train, and datdemon. Pushing 20s and 21s in season 1. I''m an east coast dad so raid times won''t be a problem and will be one who consistently shows up every week and will rarely miss raids.', 'added', '2026-06-29 11:32'::timestamp),
  ('Puckchuck-Illidan',         'Rogue',        'Assassination', 'Outlaw, Subtlety',        true,  null, 'rejected', '2026-06-29 09:09'::timestamp),
  ('Conflagrate-Suramar',       'Warlock',      'Demonology',    'Affliction',              false, 'Available to Fury Warrior (or can learn arms as well).', 'added', '2026-06-29 09:00'::timestamp),
  ('Dayned-Dalaran',            'Druid',        'Restoration',   'Balance',                 true,  null, 'added',    '2026-06-29 08:47'::timestamp)
) as v(name_realm, class, spec, off_specs, main_swap, notes, status, submitted_at)
join public.classes_specs cs on cs.class = v.class and cs.spec = v.spec
where not exists (select 1 from public.season_signups existing where existing.team_id = 2)
  -- classes_specs is populated by hand via the SQL Editor, not a migration
  -- (docs/database-decisions.md has no entry backfilling it, unlike this
  -- file's own function-scoped classes_specs lookups). supabase/seed.sql's
  -- fixture only carries one row (id 1, Mage/Frost) for the RLS test matrix,
  -- so this guard keeps the backfill a no-op on a fresh local/CI database --
  -- otherwise the Humbledundle-Tichondrius row alone would match Mage/Frost,
  -- insert with an auto-generated id, and collide with seed.sql's hardcoded
  -- season_signups ids (1, 2, 3) applied right after this migration runs.
  and (select count(*) from public.classes_specs) > 5;
