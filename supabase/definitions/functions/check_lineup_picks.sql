-- Function public.check_lineup_picks: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.check_lineup_picks(p_team_id integer, p_player_ids integer[], p_picks jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
begin
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' then
    raise exception 'The picks must be a list.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_picks) as x(player_id integer)
    where x.player_id is null or not (x.player_id = any (p_player_ids))
  ) then
    raise exception 'A character or spec was picked for someone not in the lineup.';
  end if;

  if (select count(*) from jsonb_array_elements(p_picks))
     <> (select count(distinct x.player_id) from jsonb_to_recordset(p_picks) as x(player_id integer)) then
    raise exception 'A raider has two picks for one boss.';
  end if;

  -- Each refusal names the raider, so an officer knows whose pick to fix.
  select coalesce(p.nickname, split_part(p.name_realm, '-', 1)) into v_name
  from jsonb_to_recordset(p_picks) as x(player_id integer, character_id integer)
  left join players p on p.id = x.player_id
  where x.character_id is not null
    and not exists (
      select 1
      from players p2
      join team_members tm on tm.id = p2.team_member_id
      join characters c on c.person_id = tm.person_id
      where p2.id = x.player_id and p2.team_id = p_team_id and c.id = x.character_id
    )
  limit 1;
  if found then
    raise exception 'That character isn''t one of %''s own. Reload to see their characters.', v_name;
  end if;

  select coalesce(p.nickname, split_part(p.name_realm, '-', 1)) into v_name
    from jsonb_to_recordset(p_picks) as x(player_id integer, character_id integer, class_spec_id integer)
    join players p on p.id = x.player_id and p.team_id = p_team_id
    left join classes_specs main on main.id = p.class_spec_id
    left join characters c on c.id = x.character_id
    where x.class_spec_id is not null
      and not exists (
        -- The class of the row it is stored on: a character with the
        -- roster row's own name is stored as the roster row
        -- (lineup_picks_norm()), so its spec must be one of the roster
        -- class's (CodeRabbit on PR #1874).
        select 1 from classes_specs cs
        where cs.id = x.class_spec_id
          and cs.class = case
                when c.id is null or c.name_realm_key = lower(replace(p.name_realm, ' ', '')) then main.class
                else c.class_name
              end
      )
  limit 1;
  if found then
    raise exception 'That spec isn''t one %''s character''s class has.', v_name;
  end if;
end;
$function$;
