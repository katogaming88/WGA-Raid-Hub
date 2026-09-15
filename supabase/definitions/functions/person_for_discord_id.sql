-- Function public.person_for_discord_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.person_for_discord_id(p_discord_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id integer;
  v_account uuid;
begin
  select id into v_id from people where discord_id = p_discord_id;
  if v_id is null then
    -- The account behind that Discord id, unless it is already another
    -- person's (a second Discord login on one account): then the new row
    -- waits for its account like any listed id.
    v_account := auth_user_for_discord_id(p_discord_id);
    if exists (select 1 from people where auth_user_id = v_account) then
      v_account := null;
    end if;
    insert into people (discord_id, auth_user_id)
    values (p_discord_id, v_account)
    on conflict (discord_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from people where discord_id = p_discord_id;
    end if;
  end if;
  return v_id;
end;
$function$;
