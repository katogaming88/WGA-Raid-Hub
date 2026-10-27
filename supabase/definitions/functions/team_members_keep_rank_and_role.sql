-- Function public.team_members_keep_rank_and_role: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.team_members_keep_rank_and_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rank_named boolean := new.rank is not null
                          and (tg_op = 'INSERT' or new.rank is distinct from old.rank);
begin
  if v_rank_named then
    if tg_op = 'UPDATE' or new.role is null then
      new.role := case new.rank when 'owner' then 'team_leader'
                                when 'officer' then 'officer'
                                else 'raider' end;
    end if;
  elsif tg_op = 'INSERT' or new.role is distinct from old.role then
    new.rank := case new.role when 'team_leader' then 'owner'
                              when 'officer' then 'officer'
                              else 'raider' end;
  end if;

  if not v_rank_named and new.rank = 'owner' and new.archived_at is null
     and exists (select 1 from team_members m
                  where m.team_id = new.team_id and m.id <> new.id
                    and m.rank = 'owner' and m.archived_at is null) then
    new.rank := 'officer';
  end if;
  return new;
end;
$function$;
