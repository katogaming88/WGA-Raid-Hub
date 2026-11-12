-- Function public.recruit_record: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.recruit_record(p_application_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me integer := my_person_id();
  v_app recruit_applications;
  v_guild integer;
  v_team_name text;
  v_access text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into v_app from recruit_applications where id = p_application_id;
  select t.guild_id, t.name into v_guild, v_team_name from teams t where t.id = v_app.team_id;
  v_access := recruit_access(v_app.team_id);
  if v_access is not null and v_app.id is null then
    raise exception 'That recruit does not exist';
  end if;
  if v_app.person_id = v_me then
    raise exception 'That is your own application';
  end if;
  if v_access is null then
    if v_app.recruiter_person_id is distinct from v_me or not in_guild(v_guild, v_me) then
      raise exception 'Not authorized';
    end if;
    return jsonb_build_object(
      'access', 'recruiter',
      'id', v_app.id,
      'team_id', v_app.team_id,
      'team_name', v_team_name,
      'name', case when v_app.person_id is not null then guild_person_name(v_guild, v_app.person_id) end,
      'name_realm', v_app.name_realm,
      'status', v_app.status,
      'applied_at', v_app.applied_at,
      'closed_at', v_app.closed_at,
      'trial_starts_on', v_app.trial_starts_on,
      'trial_ends_on', v_app.trial_ends_on,
      'notes', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'source', n.source, 'created_at', n.created_at)
                         order by n.created_at, n.id)
          from recruit_notes n
         where n.application_id = v_app.id and n.author_person_id = v_me), '[]'::jsonb));
  end if;

  return (to_jsonb(v_app) - 'person_id' - 'recruiter_person_id' - 'character_id') || jsonb_build_object(
    'access', v_access,
    'team_name', v_team_name,
    'name', case when v_app.person_id is not null then guild_person_name(v_guild, v_app.person_id) end,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'author', case when n.author_person_id is not null then guild_person_name(v_guild, n.author_person_id) end,
               'mine', n.author_person_id = v_me,
               'body', n.body,
               'source', n.source,
               'created_at', n.created_at) order by n.created_at, n.id)
        from recruit_notes n
       where n.application_id = v_app.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', e.kind,
               'actor', case when e.actor_person_id is not null then guild_person_name(v_guild, e.actor_person_id) end,
               'detail', e.detail,
               'created_at', e.created_at) order by e.created_at, e.id)
        from recruit_events e
       where e.application_id = v_app.id), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'author_name', m.author_name,
               'by_applicant', m.author_discord_id is not distinct from (select discord_id from people where id = v_app.person_id)
                               and m.author_discord_id is not null,
               'body', m.body,
               'attachments', m.attachments,
               'sent_at', m.sent_at,
               'in_officer_thread', m.in_officer_thread) order by m.sent_at, m.id)
        from recruit_messages m
       where m.application_id = v_app.id), '[]'::jsonb),
    -- Earlier applications by the same person to the same guild, any team.
    'applied_before', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'team_name', t.name,
               'applied_at', a.applied_at,
               'status', a.status) order by a.applied_at desc)
        from recruit_applications a
        join teams t on t.id = a.team_id
       where a.person_id = v_app.person_id and t.guild_id = v_guild
         and (a.applied_at, a.id) < (v_app.applied_at, v_app.id)), '[]'::jsonb));
end;
$function$;
