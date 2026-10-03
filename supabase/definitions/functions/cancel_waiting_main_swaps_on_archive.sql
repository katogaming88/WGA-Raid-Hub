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

  -- The character they asked for is on the roster now, unlinked or theirs:
  -- the swap was done another way, by a signup main swap or by hand. Not
  -- for someone who has left.
  if not v_membership_ended then
    update main_swap_requests r
       set status = 'approved',
           reviewed_at = now(),
           reviewed_by = my_person_id(),
           officer_note = 'Already on the roster',
           approved_player_id = a.id
      from players a
     where r.from_player_id = new.id
       and r.team_id = new.team_id
       and r.status = 'pending'
       and a.team_id = new.team_id
       and a.name_realm_key = lower(replace(r.name_realm, ' ', ''))
       and a.archived_at is null
       and (a.team_member_id is null or a.team_member_id = new.team_member_id);
  end if;

  with cancelled as (
    update main_swap_requests
       set status = 'cancelled',
           reviewed_at = now(),
           reviewed_by = my_person_id(),
           officer_note = case when v_membership_ended then 'Membership ended' else 'Character removed' end
     where from_player_id = new.id
       and team_id = new.team_id
       and status = 'pending'
    returning name_realm
  )
  insert into notifications (team_id, player_id, message)
  select new.team_id, new.id,
         concat('Your main swap to ', c.name_realm, ' was cancelled: ', new.name_realm, ' is no longer on the roster.')
    from cancelled c
   where not v_membership_ended
     and new.team_member_id is not null;

  return new;
end;
$function$;
