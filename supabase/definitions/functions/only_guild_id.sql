-- Function public.only_guild_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.only_guild_id()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer := (select count(*) from guilds);
begin
  if v_count = 0 then
    raise exception 'There is no guild yet';
  end if;
  if v_count > 1 then
    raise exception 'There is more than one guild, so say which guild this is for';
  end if;
  return (select id from guilds);
end;
$function$;
