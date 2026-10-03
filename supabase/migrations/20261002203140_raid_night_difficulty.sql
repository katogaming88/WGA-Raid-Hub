-- #1246: a raid night says which difficulty it is for, with a team default.
--
-- The lineup can only take a boss killed earlier in the week off a later night
-- when it knows which difficulty that night is for; nothing on the schedule
-- says so today. A night's difficulty follows is_optional's pattern: a column
-- on the weekly rule (raid_schedule) and on the added night
-- (raid_schedule_exceptions), resolved per date by raid_night_info(). Null on
-- either means the team default, kept one row per team in
-- team_schedule_settings (the shape team_lineup_settings set for #1244), so a
-- team that has gone all-Mythic changes one value. A night that starts on
-- Heroic and pushes into Mythic is its own value, heroic_into_mythic, so the
-- Schedule tab shows what an officer picked; raid_night_info() reports it as
-- mythic, the difficulty that night's kills count at.
--
-- team_schedule_settings is written by the officers who write the schedule,
-- under raid_schedule's own rule, and read by anyone like the schedule:
-- raid_night_info() is not security definer, so a narrower read would give a
-- signed-out caller a different answer than an officer. The database stamps
-- its updated_at, as on team_invite_links, so no browser clock reaches it.
--
-- raid_night_info() gains a column, which a return type change can only do by
-- drop and create. The drop takes its comment and its service_role grant, both
-- repeated below.

alter table public.raid_schedule
  add column difficulty text check (difficulty in ('heroic', 'mythic', 'heroic_into_mythic'));

comment on column public.raid_schedule.difficulty is
  'Heroic, Mythic or Heroic into Mythic for this weekly night (#1246); null follows the team default in team_schedule_settings. raid_night_info() counts heroic_into_mythic as mythic.';

alter table public.raid_schedule_exceptions
  add column difficulty text check (difficulty in ('heroic', 'mythic', 'heroic_into_mythic'));

comment on column public.raid_schedule_exceptions.difficulty is
  'Heroic, Mythic or Heroic into Mythic for an added night (#1246); null follows the team default in team_schedule_settings. Only applies to an ''added'' row, as is_optional does. raid_night_info() counts heroic_into_mythic as mythic.';

create table public.team_schedule_settings (
  team_id integer primary key references public.teams(id) on delete cascade,
  default_difficulty text check (default_difficulty in ('heroic', 'mythic', 'heroic_into_mythic')),
  updated_at timestamp with time zone not null default now()
);

comment on table public.team_schedule_settings is
  'A team''s own schedule settings (#1246): the raid difficulty every weekly or added night follows unless it sets its own. No row, or a null, means not set. Written by the officers who write raid_schedule.';

alter table public.team_schedule_settings owner to postgres;
alter table public.team_schedule_settings enable row level security;

create trigger trg_team_schedule_settings_updated_at
  before update on public.team_schedule_settings
  for each row execute function public.set_updated_at();

create policy "Claude readers read team_schedule_settings" on public.team_schedule_settings
  for select to claude_readers using (true);
create policy "Public read team_schedule_settings" on public.team_schedule_settings
  for select using (true);
create policy "Officers write team_schedule_settings" on public.team_schedule_settings
  using ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())))
  with check ((((team_id = ANY ((SELECT my_officer_team_ids())::integer[]))) OR (SELECT is_guild_officer()) OR (SELECT is_site_admin())));

drop function public.raid_night_info(integer, date);

create function public.raid_night_info(p_team_id integer, p_raid_date date)
returns table("exists" boolean, start_time time without time zone, timezone text, is_optional boolean, difficulty text)
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_weekday integer := extract(dow from p_raid_date);
  v_cancelled boolean;
  v_added raid_schedule_exceptions%rowtype;
  v_rule raid_schedule%rowtype;
  v_default text;
  v_difficulty text;
begin
  select true into v_cancelled
  from raid_schedule_exceptions
  where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'cancelled';

  if v_cancelled then
    return query select false, null::time, null::text, null::boolean, null::text;
    return;
  end if;

  select default_difficulty into v_default
  from team_schedule_settings
  where team_id = p_team_id;

  select * into v_added
  from raid_schedule_exceptions
  where team_id = p_team_id and raid_date = p_raid_date and exception_type = 'added';

  if found then
    v_difficulty := coalesce(v_added.difficulty, v_default);
    return query select true, v_added.start_time, 'America/New_York'::text, v_added.is_optional,
      case v_difficulty when 'heroic_into_mythic' then 'mythic' else v_difficulty end;
    return;
  end if;

  select * into v_rule
  from raid_schedule
  where team_id = p_team_id and active and weekday = v_weekday;

  if found then
    v_difficulty := coalesce(v_rule.difficulty, v_default);
    return query select true, v_rule.start_time, v_rule.timezone, v_rule.is_optional,
      case v_difficulty when 'heroic_into_mythic' then 'mythic' else v_difficulty end;
    return;
  end if;

  return query select false, null::time, null::text, null::boolean, null::text;
end;
$$;

alter function public.raid_night_info(integer, date) owner to postgres;

comment on function public.raid_night_info(integer, date) is
  'Whether a given raid_date is a real raid night for a team, plus its start_time/timezone/is_optional (#900, part of #640) and its difficulty (#1246) -- same raid_schedule/raid_schedule_exceptions precedence as is_optional_raid_night() (cancelled exception wins > added exception wins > active recurring rule > not a raid night), extended to surface the fields the bot''s embed header and proactive lead-time sweep need. difficulty is the one the night''s kills count at: its own pick, else the team default in team_schedule_settings, with heroic_into_mythic reported as mythic, and null on a cancelled date or no night. raid_schedule_exceptions has no timezone column, so an ''added'' night is assumed America/New_York, matching every other place in this schema that treats it as the implicit single timezone. Keep in sync with is_optional_raid_night() and js/calendar.js''s computeRaidNights() if this precedence ever changes.';

grant execute on function public.raid_night_info(integer, date) to service_role;
