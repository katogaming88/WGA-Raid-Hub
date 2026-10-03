-- Function public.cancel_waiting_main_swaps_on_archive: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.cancel_waiting_main_swaps_on_archive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_membership_ended boolean;
begin
  select tm.archived_at is not null into v_membership_ended
    from team_members tm
   where tm.id = new.team_member_id;
  v_membership_ended := coalesce(v_membership_ended, false);

  with cancelled as (
    update main_swap_requests
       set status = 'cancelled',
           reviewed_at = now(),
           reviewed_by = my_person_id(),
           officer_note = case when v_membership_ended then 'Membership ended' else 'Character removed' end
     where from_player_id = new.id
       and status = 'pending'
    returning name_realm
  )
  insert into notifications (team_id, player_id, message)
  select new.team_id, new.id,
         concat('Your main swap to ', c.name_realm, ' was cancelled: ', new.name_realm, ' is no longer on the roster.')
    from cancelled c
   where not v_membership_ended;

  return new;
end;
$function$;
