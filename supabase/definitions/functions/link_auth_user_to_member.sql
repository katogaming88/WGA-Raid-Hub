-- Function public.link_auth_user_to_member: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.link_auth_user_to_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only a Discord identity links a Discord-keyed grant. One early return
  -- rather than a condition on each update, so a fifth grant table added later
  -- is covered without anyone remembering.
  if new.provider is distinct from 'discord' then
    return new;
  end if;

  update team_members
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update site_admins
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update boe_managers
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update guild_officers
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  return new;
end;
$function$;
