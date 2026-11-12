-- #1817: team_recruits() also returns what the Recruits page (#1549) shows
-- and an officer can't read anywhere else.
--
-- * min_item_level and needs (the team's open spots, as
--   team_recruiting_spot_list() gives them), at the top level. Until now only
--   team_recruiting_settings() had them, which is Edit recruiting only, so an
--   assistant or guild Admin allowed to see tickets couldn't be shown a low
--   item level or a class the team isn't looking for. Nothing else from the
--   team's settings.
-- * reminded, per recruit: the bot has sent this turn's reply_reminder (the
--   "Reminded them to reply" DM). recruit-reminders claims one per turn in
--   recruit_reminders_sent with due_for = the applicant's last word (their
--   last message, else applied_at), so a newer applicant message starts a
--   new turn and reminded goes back to false. Only while it is the
--   applicant's turn.
-- * ticket_url, per recruit: the link to the Discord ticket while it still
--   exists (channel known, not deleted from Discord, the team's server set),
--   built as my_applications() builds the applicant's (#1810). The server id
--   lives in team_discord_config, which officers can't read. A closed record
--   keeps its link until the bot deletes the channel.
--
-- Same signature, same gate (recruit_access()), nothing writable.

create or replace function public.team_recruits(p_team_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

comment on function public.team_recruits(integer) is
  'A team''s recruit records for its Recruits page (#1539, #1549), open first: the character copy, status, who sent them, dates and last-message times, whether this turn''s reply reminder went (reminded) and the ticket''s Discord link while it exists (ticket_url, #1817); plus the caller''s access (manage, note or read) and the team''s min_item_level and needs (open spots). For whoever recruit_access() lets in.';

revoke all on function public.team_recruits(integer) from public, anon;
grant execute on function public.team_recruits(integer) to authenticated;
