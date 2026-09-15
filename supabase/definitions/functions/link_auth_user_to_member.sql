-- Function public.link_auth_user_to_member: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.link_auth_user_to_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_listed integer;
  v_own integer;
begin
  select id into v_own from people where auth_user_id = new.user_id;

  -- Only a Discord identity attaches a person listed by Discord id.
  if new.provider is distinct from 'discord' then
    if v_own is null then
      insert into people (auth_user_id) values (new.user_id) on conflict do nothing;
    end if;
    return new;
  end if;

  select id into v_listed from people where discord_id = new.provider_id;

  if v_listed is null and v_own is null then
    insert into people (auth_user_id, discord_id) values (new.user_id, new.provider_id);
  elsif v_listed is null then
    update people set discord_id = new.provider_id where id = v_own and discord_id is null;
  elsif v_own is null then
    update people set auth_user_id = new.user_id where id = v_listed and auth_user_id is null;
  elsif v_listed <> v_own then
    delete from people where id = v_own;
    update people set auth_user_id = new.user_id where id = v_listed and auth_user_id is null;
  end if;

  return new;
end;
$function$;
