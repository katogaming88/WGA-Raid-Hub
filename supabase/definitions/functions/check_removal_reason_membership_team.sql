-- Function public.check_removal_reason_membership_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.check_removal_reason_membership_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.player_id is null and new.team_member_id is not null
     and new.team_id is distinct from (select team_id from team_members where id = new.team_member_id) then
    raise exception 'team_id % does not match team_members.team_id for team_member_id %',
      new.team_id, new.team_member_id;
  end if;
  return new;
end;
$function$;
