-- Function public.team_recruits: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_recruits(p_team_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_access text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  v_access := recruit_access(p_team_id);
  if v_access is null then
    raise exception 'Not authorized';
  end if;
  return jsonb_build_object(
    'access', v_access,
    'min_item_level', (select r.min_item_level from team_recruiting r where r.team_id = p_team_id),
    'needs', team_recruiting_spot_list(p_team_id),
    'recruits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'name', case when a.person_id is not null then guild_person_name(t.guild_id, a.person_id) end,
               'name_realm', a.name_realm,
               'class_name', a.class_name,
               'spec_name', a.spec_name,
               'item_level', a.item_level,
               'mplus_score', a.mplus_score,
               'logs_best_average', a.logs_best_average,
               'logs_median_average', a.logs_median_average,
               'mythic_bosses_killed', a.mythic_bosses_killed,
               'source', a.source,
               'status', a.status,
               'sent_by', a.sent_by,
               'sent_by_name', a.sent_by_name,
               'applied_at', a.applied_at,
               'closed_at', a.closed_at,
               'applicant_last_message_at', a.applicant_last_message_at,
               'officers_last_message_at', a.officers_last_message_at,
               'trial_starts_on', a.trial_starts_on,
               'trial_ends_on', a.trial_ends_on,
               'reminded', a.status = 'waiting_on_applicant' and exists (
                 select 1 from recruit_reminders_sent s
                  where s.application_id = a.id and s.reminder = 'reply_reminder'
                    and s.due_for = coalesce(a.applicant_last_message_at, a.applied_at)),
               'ticket_url', case
                 when a.ticket_deleted_at is null and a.discord_channel_id is not null
                      and c.guild_id ~ '^[0-9]{17,20}$'
                 then 'https://discord.com/channels/' || c.guild_id || '/' || a.discord_channel_id
               end)
             order by a.closed_at is not null, a.applied_at desc, a.id desc)
        from recruit_applications a
        join teams t on t.id = a.team_id
        left join team_discord_config c on c.team_id = a.team_id
       where a.team_id = p_team_id and a.person_id is distinct from my_person_id()), '[]'::jsonb));
end;
$function$;
