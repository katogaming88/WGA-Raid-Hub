-- Function public.link_battlenet_roster_characters: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.link_battlenet_roster_characters(p_person_id integer, p_characters jsonb)
 RETURNS TABLE(player_id integer, team_id integer, name_realm text, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_discord_id text;
  v_row record;
  v_member_id integer;
begin
  select discord_id into v_discord_id from people where id = p_person_id;
  if not found then
    raise exception 'No person with id %', p_person_id;
  end if;

  for v_row in
    select p.id, p.team_id, p.name_realm, p.team_member_id, tm.person_id as holder
      from players p
      left join team_members tm on tm.id = p.team_member_id
     where p.archived_at is null
       and p.name_realm_key in (
         select lower(replace((c ->> 'name') || '-' || (c ->> 'realm'), ' ', ''))
           from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) c
       )
     order by p.team_id, p.name_realm
  loop
    player_id := v_row.id;
    team_id := v_row.team_id;
    name_realm := v_row.name_realm;

    if v_row.team_member_id is not null then
      outcome := case when v_row.holder = p_person_id then 'already_yours' else 'claimed_by_someone_else' end;
      return next;
      continue;
    end if;

    select tm.id into v_member_id
      from team_members tm
     where tm.team_id = v_row.team_id and tm.person_id = p_person_id;

    if v_member_id is null then
      if v_discord_id is null then
        outcome := 'needs_discord';
        return next;
        continue;
      end if;
      insert into team_members (team_id, discord_id, role)
      values (v_row.team_id, v_discord_id, 'raider')
      returning id into v_member_id;
    end if;

    -- The same guard claim_character() rides on: the write only lands on a row
    -- still unclaimed, so a claim racing this one cannot be overwritten.
    update players set team_member_id = v_member_id
     where id = v_row.id and team_member_id is null;

    outcome := case when found then 'linked' else 'claimed_by_someone_else' end;
    return next;
  end loop;
end;
$function$;
