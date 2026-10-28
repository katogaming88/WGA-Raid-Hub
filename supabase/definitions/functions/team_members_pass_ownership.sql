-- Function public.team_members_pass_ownership: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_members_pass_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.rank = 'owner' and old.archived_at is null
     and (tg_op = 'DELETE' or new.rank <> 'owner' or new.archived_at is not null
          or new.team_id <> old.team_id)
     and not exists (select 1 from team_members
                      where team_id = old.team_id and rank = 'owner' and archived_at is null) then
    update team_members set rank = 'owner'
     where id = (select id from team_members
                  where team_id = old.team_id and role = 'team_leader' and archived_at is null
                    and id <> old.id
                  order by auth_user_id is null, id
                  limit 1);
  end if;
  return null;
end;
$function$;
