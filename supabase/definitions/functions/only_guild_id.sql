-- Function public.only_guild_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.only_guild_id()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from guilds) <> 1 then
    raise exception 'A grant needs a guild once there is more than one (#1045)';
  end if;
  return (select id from guilds);
end;
$function$;
