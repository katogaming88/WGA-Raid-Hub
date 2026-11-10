-- Function public.recruit_trial_not_joining: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_trial_not_joining(p_application_id integer, p_actor integer, p_reason text, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_app recruit_applications;
  v_detail text := nullif(btrim(p_detail), '');
  v_member integer;
  v_removed_at timestamptz;
  v_member_archived boolean := false;
begin
  if p_reason is null or p_reason not in
     ('schedule_conflict', 'performance', 'drama', 'moved_guilds', 'switching_mains', 'other', 'no_signup') then
    raise exception 'That is not one of the removal reasons';
  end if;
  if char_length(v_detail) > 500 then
    raise exception 'A reason is at most 500 characters';
  end if;
  v_app := recruit_lock(p_application_id, p_actor);
  if v_app.status <> 'on_trial' then
    raise exception 'That recruit is not on trial';
  end if;

  select p.team_member_id into v_member from players p where p.id = v_app.trial_player_id;
  perform 1 from team_members m where m.id = v_member for update;

  -- A raider with no other character on the team leaves it too. The
  -- membership goes first, as in archive_team_member(), so a waiting main
  -- swap the character's archive closes reads "Membership ended" rather than
  -- "Character removed" with a notice (CodeRabbit).
  if exists (select 1 from team_members m
              where m.id = v_member and m.archived_at is null and m.rank = 'raider')
     and not exists (select 1 from players p
                      where p.team_member_id = v_member and p.archived_at is null
                        and p.id <> v_app.trial_player_id) then
    insert into removal_reasons (team_id, team_member_id, reason, detail, removed_by)
    values (v_app.team_id, v_member, p_reason, v_detail, p_actor);
    update team_members set archived_at = now() where id = v_member;
    v_member_archived := true;
  end if;

  update players set archived_at = now()
   where id = v_app.trial_player_id and archived_at is null
  returning archived_at into v_removed_at;
  if v_removed_at is not null then
    -- The removal in the actor's name first: the notes write's own row
    -- (record_removal_reason()) then finds it and adds nothing, where from
    -- the bot it would name nobody.
    insert into removal_reasons (team_id, player_id, team_member_id, removed_at, reason, detail, removed_by)
    values (v_app.team_id, v_app.trial_player_id, v_member, v_removed_at, p_reason, v_detail, p_actor);
    -- Only the archive columns, as in archive_player(): an officer note stays.
    insert into player_officer_notes (player_id, team_id, archived_reason, archived_reason_detail)
    values (v_app.trial_player_id, v_app.team_id, p_reason, v_detail)
    on conflict (player_id) do update
       set archived_reason = excluded.archived_reason,
           archived_reason_detail = excluded.archived_reason_detail;
  end if;

  update recruit_applications set status = 'not_joining', closed_at = now() where id = p_application_id;
  insert into recruit_events (application_id, kind, actor_person_id, detail)
  values (p_application_id, 'not_joining', p_actor, concat_ws(': ', recruit_reason_words(p_reason), v_detail));
  perform recruit_log(v_app.team_id, p_actor, 'Recruit Not Joining', p_application_id,
                      jsonb_build_object('name_realm', v_app.name_realm, 'player_id', v_app.trial_player_id,
                                         'reason', p_reason, 'detail', v_detail,
                                         'membership_archived', v_member_archived));
end;
$function$;
