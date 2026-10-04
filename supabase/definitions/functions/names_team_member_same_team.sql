-- Function public.names_team_member_same_team: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): public

CREATE OR REPLACE FUNCTION public.names_team_member_same_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_member_team_id integer;
begin
  if new.team_member_id is null then
    return new;
  end if;
  select team_id into v_member_team_id from public.team_members where id = new.team_member_id;
  if v_member_team_id is null or v_member_team_id <> new.team_id then
    raise exception 'That membership is not on this team';
  end if;
  return new;
end;
$function$;
