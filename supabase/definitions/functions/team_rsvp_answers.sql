-- Function public.team_rsvp_answers: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_rsvp_answers(p_team_id integer, p_from date, p_to date)
 RETURNS TABLE(player_id integer, raid_date date, status text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (
    exists (
      select 1 from players p
      where p.team_id = p_team_id
        and p.id = any (public.my_active_player_ids())
    )
    or coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_guild_officer()
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.';
  end if;

  return query
    select r.player_id, r.raid_date, r.status, r.updated_at
    from raid_rsvps r
    where r.team_id = p_team_id
      and r.raid_date between p_from and p_to
    order by r.raid_date, r.player_id;
end;
$function$;
