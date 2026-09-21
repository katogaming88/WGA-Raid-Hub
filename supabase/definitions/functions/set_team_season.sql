-- Function public.set_team_season: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_team_season(p_team_id integer, p_season_code text, p_signups_open boolean DEFAULT NULL::boolean, p_wishlist_open boolean DEFAULT NULL::boolean)
 RETURNS team_seasons
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.team_seasons;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not (p_team_id = any (public.my_leader_team_ids()) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from public.seasons where code = p_season_code) then
    raise exception '% is not a season this site knows', p_season_code;
  end if;

  insert into public.team_seasons (team_id, season_code, signups_open, wishlist_open)
  values (p_team_id, p_season_code, coalesce(p_signups_open, false), coalesce(p_wishlist_open, false))
  on conflict (team_id, season_code) do update
    set signups_open = coalesce(p_signups_open, team_seasons.signups_open),
        wishlist_open = coalesce(p_wishlist_open, team_seasons.wishlist_open),
        updated_at = now()
  returning * into v_row;

  if p_signups_open is not null then
    perform public.write_audit_log(
      p_team_id,
      case when p_signups_open then 'Signups Opened' else 'Signups Closed' end,
      'team_seasons',
      v_row.id::integer,
      jsonb_build_object('season', p_season_code)
    );
  end if;
  if p_wishlist_open is not null then
    perform public.write_audit_log(
      p_team_id,
      case when p_wishlist_open then 'Wishlist Editing Opened' else 'Wishlist Editing Closed' end,
      'team_seasons',
      v_row.id::integer,
      jsonb_build_object('season', p_season_code)
    );
  end if;

  return v_row;
end;
$function$;
