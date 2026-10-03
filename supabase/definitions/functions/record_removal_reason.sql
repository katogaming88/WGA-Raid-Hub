-- Function public.record_removal_reason: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.record_removal_reason()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.removal_reasons (team_id, player_id, team_member_id, removed_at, reason, detail, removed_by)
  select new.team_id, new.player_id, p.team_member_id, p.archived_at, new.archived_reason,
         new.archived_reason_detail, public.my_person_id()
    from public.players p
   where p.id = new.player_id and p.archived_at is not null
  on conflict (player_id, removed_at, reason, detail) where player_id is not null do nothing;
  return null;
end;
$function$;
