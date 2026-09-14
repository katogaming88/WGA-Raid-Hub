-- Function public.retire_team_url_key: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.retire_team_url_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.retired_url_keys (guild_id, team_id, url_key)
  values (old.guild_id, old.id, old.slug)
  on conflict on constraint retired_url_keys_one_per_owner do update set retired_at = now();

  delete from public.retired_url_keys
   where guild_id = new.guild_id and team_id = new.id and url_key = new.slug;
  return new;
end;
$function$;
