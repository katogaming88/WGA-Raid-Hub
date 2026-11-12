-- #1814: who a team's recruiting tickets would add, for its Recruiting
-- settings page (#1548).
--
-- recruit-ticket adds the team's Owner and officers, its assistants and the
-- guild's Owner and Admins (the last two when the team ticked them) to each
-- ticket by their linked Discord account. Someone with none can't be added,
-- and the settings page has to say so (#1541). An officer can't read anyone's
-- Discord link, so this returns the list with a yes or no for each, and
-- nothing else about their Discord.

create function public.team_ticket_viewers(p_team_id integer)
returns table (display_name text, viewer_group text, discord_linked boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    select g.person_id, 'guild_admin', 3, guild_person_name(v_guild, g.person_id)
      from guild_ranks g
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
$$;

comment on function public.team_ticket_viewers(integer) is
  'Who the team''s recruiting tickets would add (#1814, for #1548): its Owner and officers, assistants and the guild''s Owner and Admins as the team''s visibility settings say, each once, with whether their Discord is linked. For edit_recruiting holders and site admins. No Discord id or username.';

revoke all on function public.team_ticket_viewers(integer) from public, anon;
grant execute on function public.team_ticket_viewers(integer) to authenticated;
