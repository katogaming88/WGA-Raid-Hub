-- Function public.save_battlenet_characters: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.save_battlenet_characters(p_person_id integer, p_characters jsonb)
 RETURNS SETOF characters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team integer;
begin
  if not exists (select 1 from people where id = p_person_id) then
    raise exception 'No person with id %', p_person_id;
  end if;

  for v_team in
    with listed as (
      select (x ->> 'blizzard_id')::bigint as blizzard_id
      from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
    ),
    touched as (
      select c.id from characters c
      where (c.person_id = p_person_id and c.blizzard_id not in (select blizzard_id from listed))
         or (c.person_id <> p_person_id and c.blizzard_id in (select blizzard_id from listed))
    )
    select l.team_id from raid_night_lineups l where l.character_id in (select id from touched)
    union
    select g.team_id from boss_groups g where g.character_id in (select id from touched)
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('boss_lineup'), v_team);
  end loop;

  delete from characters c
   where c.person_id = p_person_id
     and c.blizzard_id not in (
       select (x ->> 'blizzard_id')::bigint from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
     );

  insert into characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
  select p_person_id,
         (x ->> 'blizzard_id')::bigint,
         x ->> 'name',
         x ->> 'realm',
         x ->> 'realm_slug',
         x ->> 'class_name',
         x ->> 'spec_name',
         (x ->> 'level')::integer,
         (x ->> 'item_level')::integer
    from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) x
  on conflict (blizzard_id) do update
    set person_id = excluded.person_id,
        name = excluded.name,
        realm = excluded.realm,
        realm_slug = excluded.realm_slug,
        class_name = excluded.class_name,
        spec_name = excluded.spec_name,
        level = excluded.level,
        item_level = excluded.item_level,
        saved_at = now();

  return query select * from characters where person_id = p_person_id order by name, realm;
end;
$function$;
