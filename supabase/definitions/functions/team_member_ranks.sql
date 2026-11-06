-- Function public.team_member_ranks: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_member_ranks(p_team_id integer)
 RETURNS TABLE(team_member_id integer, display_name text, rank text, signed_in boolean, is_you boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.has_team_permission(p_team_id, 'promote_assistants')
     and not public.has_guild_permission((select t.guild_id from teams t where t.id = p_team_id), 'change_team_owner') then
    raise exception 'Not authorized';
  end if;

  return query
  select
    m.id,
    public.team_member_name(p_team_id, m.id),
    m.rank,
    pe.auth_user_id is not null,
    pe.id = my_person_id()
    from team_members m
    join people pe on pe.id = m.person_id
   where m.team_id = p_team_id and m.archived_at is null
   order by array_position(array['owner', 'officer', 'assistant', 'raider'], m.rank), 2;
end;
$function$;
