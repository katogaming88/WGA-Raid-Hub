-- Function public.team_members_guard_rank: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_members_guard_rank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user = 'authenticated'
     and new.rank is not null
     and (tg_op = 'INSERT' or new.rank is distinct from old.rank) then
    raise exception 'A team rank is changed through the rank functions, not by editing the membership';
  end if;
  return new;
end;
$function$;
