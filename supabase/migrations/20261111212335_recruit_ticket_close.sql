-- #1544: closing a recruit's Discord ticket. When a record closes (declined,
-- no reply, joined, not joining, withdrawn), the 15-minute sweep
-- (recruit-reminders) locks the ticket, posts a closing message, saves the
-- conversation to recruit_messages, and deletes the channel after the team's
-- delete_closed_after_hours. An officer-only thread is saved and deleted the
-- same way. Save first, delete second: a ticket that hasn't saved is never
-- deleted.
--
-- What this adds:
--
-- * Four columns on recruit_applications, the bot's progress through that,
--   written with the service key: ticket_closed_at (locked and the closing
--   message posted), ticket_saved_at (the whole conversation saved),
--   ticket_deleted_at (gone from Discord) and ticket_save_failures (how many
--   sweeps in a row the save failed; at 3 the officer channel is told once).
--   A reopen before the deletion is the sweep's to undo: it sees an open
--   record with ticket_closed_at set, unlocks the ticket and clears the three
--   times. recruit_record() returns them with the rest of the record.
-- * recruit_messages.in_officer_thread: a saved message from the officer-only
--   thread rather than the ticket, so the Recruits page (#1549) can keep the
--   two apart. recruit_record() returns it.
-- * recruit_record()'s earlier applications carry their id, for the card's
--   link to the saved conversation (#1544's second part).
-- * bot_close_no_reply(): the sweep closes a record as No reply once the
--   team's close_no_reply_after_hours has passed since the officers' last
--   message. Under the row lock it checks again that it is still the
--   applicant's turn and that the team's time has passed since the officers'
--   last saved message or a reopen, so an answer or a newer officer message
--   saved as the sweep runs keeps the record open. Service role only; nobody
--   signed in can call it.

alter table public.recruit_applications
  add column ticket_closed_at timestamptz,
  add column ticket_saved_at timestamptz,
  add column ticket_deleted_at timestamptz,
  add column ticket_save_failures integer not null default 0
    constraint recruit_applications_ticket_save_failures check (ticket_save_failures >= 0);

comment on column public.recruit_applications.ticket_closed_at is
  'When the bot locked the closed record''s ticket and posted the closing message (#1544). Cleared when a reopen unlocks it.';
comment on column public.recruit_applications.ticket_saved_at is
  'When the bot saved the closed ticket''s whole conversation to recruit_messages (#1544). Never deleted before this is set.';
comment on column public.recruit_applications.ticket_deleted_at is
  'When the bot deleted the closed ticket and officer thread from Discord (#1544), delete_closed_after_hours after ticket_closed_at.';
comment on column public.recruit_applications.ticket_save_failures is
  'Sweeps in a row the save failed (#1544); the officer channel is told at 3. Back to 0 once it saves.';

alter table public.recruit_messages
  add column in_officer_thread boolean not null default false;

comment on column public.recruit_messages.in_officer_thread is
  'From the officer-only thread, not the ticket the applicant saw (#1544).';

create or replace function public.recruit_record(p_application_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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

create function public.bot_close_no_reply(p_application_id integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_app recruit_applications;
  v_hours integer;
  v_from timestamptz;
begin
  select * into v_app from recruit_applications where id = p_application_id for update;
  if not found or v_app.closed_at is not null or v_app.status <> 'waiting_on_applicant' then
    return false;
  end if;
  -- The deadline again, under the lock: a newer officer message or a reopen
  -- saved since the sweep decided starts the wait over (CodeRabbit).
  select r.close_no_reply_after_hours into v_hours from team_recruiting r where r.team_id = v_app.team_id;
  select greatest(v_app.officers_last_message_at, max(e.created_at)) into v_from
    from recruit_events e
   where e.application_id = p_application_id and e.kind = 'reopened';
  if v_hours is null or v_from is null or v_from + make_interval(hours => v_hours) > now() then
    return false;
  end if;
  perform recruit_close(p_application_id, null, 'no_reply', null);
  return true;
end;
$$;

comment on function public.bot_close_no_reply(integer) is
  'The sweep''s No reply close (#1544): closes an open record still waiting on the applicant once the team''s close_no_reply_after_hours has passed since the officers'' last message or a reopen, with no actor. False otherwise. Service role only.';

revoke all on function public.bot_close_no_reply(integer) from public, anon, authenticated;
grant execute on function public.bot_close_no_reply(integer) to service_role;
