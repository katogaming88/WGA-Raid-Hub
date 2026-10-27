-- Function public.guild_ranks_keep_grant: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.guild_ranks_keep_grant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op <> 'INSERT' and old.rank in ('owner', 'admin')
     and (tg_op = 'DELETE' or new.rank not in ('owner', 'admin')) then
    delete from guild_grants
     where person_id = old.person_id and guild_id = old.guild_id and grant_type = 'guild_officer';
  end if;
  if tg_op <> 'DELETE' and new.rank in ('owner', 'admin') then
    insert into guild_grants (person_id, guild_id, grant_type)
    values (new.person_id, new.guild_id, 'guild_officer')
    on conflict (person_id, guild_id, grant_type) do nothing;
  end if;
  return null;
end;
$function$;
