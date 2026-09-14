-- Function public.claim_raid_signup_sheet: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.claim_raid_signup_sheet(p_team_id integer, p_raid_date date, p_channel_id text)
 RETURNS TABLE(message_id text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_channel_id text;
  v_message_id text;
  v_found boolean;
begin
  select r.channel_id, r.message_id into v_channel_id, v_message_id
  from raid_signup_sheets r
  where r.team_id = p_team_id and r.raid_date = p_raid_date
  for update;
  v_found := found;

  if not v_found then
    begin
      insert into raid_signup_sheets (team_id, raid_date, channel_id, message_id, updated_at)
      values (p_team_id, p_raid_date, p_channel_id, null, now());
      return query select null::text;
      return;
    exception when unique_violation then
      -- Rare race: two truly-simultaneous first-ever calls for this date
      -- both missed the row lock above because neither row existed yet to
      -- lock. Self-healing: re-select and fall through to the normal path
      -- below -- worst case is one extra duplicate message, never repeating,
      -- since only one message_id ever survives in the row going forward.
      select r.channel_id, r.message_id into v_channel_id, v_message_id
      from raid_signup_sheets r
      where r.team_id = p_team_id and r.raid_date = p_raid_date
      for update;
    end;
  end if;

  if v_channel_id is distinct from p_channel_id then
    -- Officer reconfigured the channel since this row was created -- the
    -- stored message_id (if any) lives in the old channel and can't be
    -- edited from the new one. Reset so the caller creates a fresh message.
    update raid_signup_sheets
    set channel_id = p_channel_id, message_id = null, updated_at = now()
    where team_id = p_team_id and raid_date = p_raid_date;
    return query select null::text;
    return;
  end if;

  return query select v_message_id;
end;
$function$;
