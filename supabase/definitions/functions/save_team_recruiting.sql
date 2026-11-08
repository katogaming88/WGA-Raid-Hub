-- Function public.save_team_recruiting: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.save_team_recruiting(p_team_id integer, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old team_recruiting;
  v_new team_recruiting;
  v_bad text;
  v_detail jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_team_permission(p_team_id, 'edit_recruiting') or is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if exists (select 1 from teams t where t.id = p_team_id and t.archived_at is not null) then
    raise exception 'That team is archived. Bring it back first.';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Changes must be an object of settings';
  end if;

  select * into v_old from team_recruiting r where r.team_id = p_team_id for update;
  if not found then
    raise exception 'That team does not exist';
  end if;

  select k into v_bad
    from jsonb_object_keys(p_changes) as k
   where k in ('team_id', 'updated_at') or not (to_jsonb(v_old) ? k)
   limit 1;
  if v_bad is not null then
    raise exception 'That is not a recruiting setting: %', v_bad;
  end if;

  v_new := jsonb_populate_record(v_old, p_changes);

  select jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', to_jsonb(v_new) -> o.key))
    into v_detail
    from jsonb_each(to_jsonb(v_old)) o
   where o.key <> 'updated_at' and o.value is distinct from to_jsonb(v_new) -> o.key;

  -- Nothing actually changed: nothing to write or log.
  if v_detail is null then
    return;
  end if;

  update team_recruiting r
     set taking_applications = v_new.taking_applications,
         join_method = v_new.join_method,
         ticket_link = v_new.ticket_link,
         listed_on_guild_page = v_new.listed_on_guild_page,
         about = v_new.about,
         schedule_note = v_new.schedule_note,
         extra_night = v_new.extra_night,
         raid_languages = v_new.raid_languages,
         split_runs = v_new.split_runs,
         alts_expected = v_new.alts_expected,
         ptr_testing = v_new.ptr_testing,
         min_item_level = v_new.min_item_level,
         attendance_percent = v_new.attendance_percent,
         trial_days = v_new.trial_days,
         logs_required = v_new.logs_required,
         other_requirements = v_new.other_requirements,
         exceptional_line_on = v_new.exceptional_line_on,
         exceptional_line = v_new.exceptional_line,
         discord_mode = v_new.discord_mode,
         officer_thread_with_ticket = v_new.officer_thread_with_ticket,
         add_to_server = v_new.add_to_server,
         ticket_category_id = v_new.ticket_category_id,
         visible_to_team_officers = v_new.visible_to_team_officers,
         visible_to_team_assistants = v_new.visible_to_team_assistants,
         visible_to_guild_admins = v_new.visible_to_guild_admins,
         visible_to_role_ids = v_new.visible_to_role_ids,
         dm_reply_after_minutes = v_new.dm_reply_after_minutes,
         remind_after_hours = v_new.remind_after_hours,
         close_no_reply_after_hours = v_new.close_no_reply_after_hours,
         ping_officers_after_hours = v_new.ping_officers_after_hours,
         ping_owner_after_hours = v_new.ping_owner_after_hours,
         trial_end_notice_hours = v_new.trial_end_notice_hours,
         delete_closed_after_hours = v_new.delete_closed_after_hours,
         updated_at = now()
   where r.team_id = p_team_id;

  insert into audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Recruiting Settings Changed', 'teams', p_team_id, v_detail);
end;
$function$;
