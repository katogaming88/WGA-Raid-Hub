-- Function public.team_ticket_viewers: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_ticket_viewers(p_team_id integer)
 RETURNS TABLE(display_name text, viewer_group text, discord_linked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row team_recruiting;
  v_guild integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  select * into v_row from team_recruiting r where r.team_id = p_team_id;
  if not found then
    raise exception 'That team does not exist';
  end if;
  select t.guild_id into v_guild from teams t where t.id = p_team_id;

  -- The same people recruit-ticket's viewerIds() picks: current members only,
  -- each person once, in their first group.
  return query
  with picked as (
    select m.person_id,
           case when m.rank in ('owner', 'officer') then 'officer' else 'assistant' end as grp,
           case when m.rank in ('owner', 'officer') then 1 else 2 end as ord,
           team_member_name(p_team_id, m.id) as name
      from team_members m
     where m.team_id = p_team_id and m.archived_at is null
       and ((v_row.visible_to_team_officers and m.rank in ('owner', 'officer'))
            or (v_row.visible_to_team_assistants and m.rank = 'assistant'))
    union all
    -- A guild Admin who is also on this team goes by the team's name for them,
    -- as the roster shows it (CodeRabbit).
    select g.person_id, 'guild_admin', 3,
           -- team_member_name() never answers null (its last fallback is
           -- 'Unnamed'), so pick by whether they are on the team (fresh review).
           case when tm.id is not null then team_member_name(p_team_id, tm.id)
                else guild_person_name(v_guild, g.person_id) end
      from guild_ranks g
      left join team_members tm
        on tm.team_id = p_team_id and tm.person_id = g.person_id and tm.archived_at is null
     where v_row.visible_to_guild_admins and g.guild_id = v_guild and g.rank in ('owner', 'admin')
  ),
  once as (
    select distinct on (p.person_id) p.person_id, p.grp, p.ord, p.name
      from picked p
     order by p.person_id, p.ord
  )
  select coalesce(o.name, 'Someone'), o.grp, pe.discord_id is not null
    from once o
    join people pe on pe.id = o.person_id
   order by o.ord, 1;
end;
$function$;
