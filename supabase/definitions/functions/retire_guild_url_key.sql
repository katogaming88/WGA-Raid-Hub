-- Function public.retire_guild_url_key: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.retire_guild_url_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.retired_url_keys (guild_id, team_id, url_key)
  values (old.id, null, old.url_key)
  on conflict on constraint retired_url_keys_one_per_owner do update set retired_at = now();

  delete from public.retired_url_keys
   where guild_id = new.id and team_id is null and url_key = new.url_key;
  return new;
end;
$function$;
