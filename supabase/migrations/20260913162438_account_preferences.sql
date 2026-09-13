-- #940: one per-account preferences store, replacing a table per flag.
--
-- Russell's rule (2026-09-05): a "don't show me this again" is a key in a
-- per-account store, not a table of its own. A spike over every per-person
-- fact found exactly two that belong to the account:
--
--   1. no_character_dismissed -- "I don't have a character, stop asking me
--      to claim one" (#512). Guild-wide, so team_id is null. It lived in
--      no_character_dismissals, which nothing ever cleared: 11 of its 12 rows
--      on prod belong to accounts that have since claimed a character.
--   2. notifications_cleared_through -- the highest notification id the
--      person cleared from the bell. Per team. It lived only in the
--      browser's localStorage, so it was lost on a new device and orphaned
--      by a character rename, alongside the database's own read flag.
--
-- Key-value rows rather than one jsonb blob per account, so each key keeps
-- its own set_at and the allowed keys stay enumerable (the blob shape is what
-- team_settings.config drifted into). A CHECK names every allowed key, so
-- adding one is a migration and not a typo, and pins which keys are
-- guild-wide and which are per team.
--
-- The unique key is a real constraint with NULLS NOT DISTINCT (Postgres 15+;
-- prod is 17), not an expression index on coalesce(team_id, 0): PostgREST's
-- on_conflict takes column names and needs a matching constraint, and the
-- client upserts guild-wide and per-team keys through the same call.
--
-- Direct writes under RLS, no RPC, for the same reason #512 gave: there is
-- no cross-table validation, only "write one row for myself".

create table public.account_preferences (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  team_id integer references public.teams (id) on delete cascade,
  key text not null,
  value jsonb not null,
  set_at timestamp with time zone not null default now(),
  constraint account_preferences_one_per_key unique nulls not distinct (auth_user_id, team_id, key),
  constraint account_preferences_known_key check (
    (key = 'no_character_dismissed' and team_id is null)
    or (key = 'notifications_cleared_through' and team_id is not null)
  )
);

comment on table public.account_preferences is
  'Per-account preferences, one row per (account, team, key); team_id is null for guild-wide keys. The account_preferences_known_key CHECK lists every allowed key. Replaced no_character_dismissals (#940).';

alter table public.account_preferences enable row level security;

create policy "Accounts manage own account_preferences" on public.account_preferences
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "Claude readers read account_preferences" on public.account_preferences
  for select to claude_readers using (true);

grant select, insert, update on table public.account_preferences to authenticated;
grant select on table public.account_preferences to claude_readers;

-- An upsert that updates a value should move set_at too; the column default
-- only covers the insert.
create or replace function public.touch_account_preference_set_at() returns trigger
language plpgsql set search_path to 'public'
as $$
begin
  new.set_at = now();
  return new;
end;
$$;

revoke all on function public.touch_account_preference_set_at() from public, anon, authenticated;

create trigger account_preferences_touch_set_at
  before update on public.account_preferences
  for each row execute function public.touch_account_preference_set_at();

-- Claiming a character clears the "no character" dismissal (Russell's rule,
-- 2026-09-05). A trigger on players rather than a line in each function,
-- because more than one path sets the link: claim_character(),
-- add_signup_to_roster()'s main swap, and any future one. Insert or update,
-- so a future path that inserts with the link already set is covered too.
-- Unlinking (the officer unlink in js/tabs/tab-roster.js sets null) does
-- nothing. Security definer because the path setting the link may be an
-- officer, who cannot read or delete another account's preference rows.
create or replace function public.clear_no_character_dismissal_on_link() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  delete from account_preferences ap
   using team_members tm
   where tm.id = new.team_member_id
     and ap.auth_user_id = tm.auth_user_id
     and ap.key = 'no_character_dismissed';
  return new;
end;
$$;

revoke all on function public.clear_no_character_dismissal_on_link() from public, anon, authenticated;

create trigger players_clear_no_character_dismissal
  after insert or update of team_member_id on public.players
  for each row
  when (new.team_member_id is not null)
  execute function public.clear_no_character_dismissal_on_link();

-- Move the dismissals across, skipping accounts that already hold a claimed
-- character: their row would have been cleared by the trigger above had it
-- existed, so carrying it over would only preserve dead weight.
insert into public.account_preferences (auth_user_id, team_id, key, value, set_at)
select d.auth_user_id, null, 'no_character_dismissed', 'true'::jsonb, d.dismissed_at
  from public.no_character_dismissals d
 where not exists (
   select 1
     from public.players p
     join public.team_members tm on tm.id = p.team_member_id
    where tm.auth_user_id = d.auth_user_id
 );

drop table public.no_character_dismissals;
