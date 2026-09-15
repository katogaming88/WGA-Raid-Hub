-- Function public.resolve_actor_name: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.resolve_actor_name(p_actor_id uuid, p_team_id integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_member_id integer;
  v_tm_name_realm text;
  v_player_name_realm text;
  v_nickname text;
  v_display text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select tm.id, tm.name_realm into v_member_id, v_tm_name_realm
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.person_id = (select pe.id from public.people pe where pe.auth_user_id = p_actor_id);

  if v_member_id is not null then
    select p.nickname, p.name_realm into v_nickname, v_player_name_realm
    from public.players p
    where p.team_member_id = v_member_id
      and p.archived_at is null
    order by p.name_realm
    limit 1;

    if v_nickname is not null and v_nickname <> '' then
      return v_nickname;
    end if;

    if coalesce(v_player_name_realm, v_tm_name_realm) is not null then
      return split_part(coalesce(v_player_name_realm, v_tm_name_realm), '-', 1);
    end if;
  end if;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  into v_display
  from auth.users u
  where u.id = p_actor_id;

  return v_display;
end;
$function$;
