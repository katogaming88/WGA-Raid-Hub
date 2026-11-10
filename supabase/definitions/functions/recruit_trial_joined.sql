-- Function public.recruit_trial_joined: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_trial_joined(p_application_id integer, p_actor integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
begin
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status <> 'on_trial' then
    raise exception 'That recruit is not on trial';
  end if;
  -- The membership before the character. A claim moving the character after
  -- this read is not covered, as in archive_player().
  perform 1 from team_members m
   where m.id = (select p.team_member_id from players p where p.id = v_app.trial_player_id)
     for share;
  update players set is_trial = false where id = v_app.trial_player_id and archived_at is null;
  if not found then
    raise exception '% is no longer on the roster: add them back first', v_app.name_realm;
  end if;
  update recruit_applications set status = 'joined', closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id) values (p_application_id, 'joined', p_actor);
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Joined', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'player_id', v_app.trial_player_id));
end;
$function$;
