-- Function public.bot_actor: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.bot_actor(p_discord_id text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_id integer;
begin
  select id into v_id from people where discord_id = p_discord_id;
  if v_id is null then
    raise exception 'Nobody on Raid Hub has that Discord id';
  end if;
  return v_id;
end;
$function$;
