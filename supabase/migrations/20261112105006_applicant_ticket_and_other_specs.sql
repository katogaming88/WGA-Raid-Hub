-- #1810: what the application form (#1547) needs from the database.
--
-- my_applications() now tells the applicant where their ticket is and how the
-- Discord step went: the after-send page and My applications show "Open my
-- ticket in Discord" only once there is a ticket to open, and "Setting up your
-- ticket..." until then. Without it the button has nothing to link to: the
-- channel id is on the record and the server id on the team's Discord
-- settings, and an applicant can read neither.
--
-- send_application() takes the other specs the applicant plays well, which
-- the record's other_specs column was made for and nothing wrote.
--
-- The M+ score, logs and Mythic kills are saved by character-stats with the
-- service key (no change here): an applicant could type any number, so they
-- never pass through the browser.

-- ---------------------------------------------------------------------------
-- my_applications(): the ticket link and the Discord step.
--
-- ticket_url: the jump link to the applicant's own ticket channel, while the
-- application is open, the ticket is still there and the team adds applicants
-- to its server. Null for a team without private tickets, before the ticket is
-- made, and once it is closed: opening one too early, or a deleted one, lands
-- on Discord's "no access" screen. The channel itself is the proof they are in
-- the server: recruit-ticket makes it only for a member (not_in_server
-- otherwise), which also covers someone who joined by the invite link after
-- discord-join failed, so a failed join doesn't hide a ticket they can open.
-- joined_discord / join_failed: the latest of discord-join's two history rows.
-- add_to_server: the team's setting now, so the page knows whether to wait for
-- the Discord step at all.

create or replace function public.my_applications()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'team_id', a.team_id,
             'team_name', t.name,
             'team_slug', t.slug,
             'guild_key', g.url_key,
             'name_realm', a.name_realm,
             'status', a.status,
             'applied_at', a.applied_at,
             'closed_at', a.closed_at,
             'trial_starts_on', a.trial_starts_on,
             'trial_ends_on', a.trial_ends_on,
             'answers', a.answers,
             'ticket_url', case
               when a.closed_at is null and a.ticket_deleted_at is null and coalesce(r.add_to_server, false)
                    and a.discord_channel_id is not null and c.guild_id ~ '^[0-9]{17,20}$'
               then 'https://discord.com/channels/' || c.guild_id || '/' || a.discord_channel_id
             end,
             'joined_discord', coalesce(d.kind = 'joined_discord', false),
             'join_failed', coalesce(d.kind = 'discord_join_failed', false),
             'add_to_server', coalesce(r.add_to_server, false)) order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
      join guilds g on g.id = t.guild_id
      left join team_recruiting r on r.team_id = a.team_id
      left join team_discord_config c on c.team_id = a.team_id
      left join lateral (
        select e.kind
          from recruit_events e
         where e.application_id = a.id and e.kind in ('joined_discord', 'discord_join_failed')
         order by e.created_at desc, e.id desc
         limit 1) d on true
     where a.person_id = my_person_id()), '[]'::jsonb);
end;
$$;

comment on function public.my_applications() is
  'The caller''s own applications (#1539, #1547), newest first: team, status, dates and answers, and for the after-send page (#1810) the link to their open ticket, whether discord-join added them or failed, and whether the team adds applicants to its server. No notes, history or conversation.';

-- ---------------------------------------------------------------------------
-- send_application(): other specs.
--
-- A new argument changes the function's signature, so the old one goes. The
-- new one defaults it to none, so a call with the first six still works.

drop function public.send_application(integer, integer, jsonb, text, text, text);

create function public.send_application(
  p_team_id integer,
  p_character_id integer,
  p_answers jsonb,
  p_recruiter_code text,
  p_friend_name text,
  p_time_zone text,
  p_other_specs text[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_me integer := my_person_id();
  v_guild integer;
  v_char characters;
  v_form jsonb;
  v_q jsonb;
  v_key text;
  v_a jsonb;
  v_text text;
  v_answers jsonb := '[]'::jsonb;
  v_sent_by text := 'nobody';
  v_recruiter integer;
  v_code text;
  v_sent_name text;
  v_friend text := nullif(btrim(p_friend_name), '');
  v_specs text[] := coalesce(p_other_specs, '{}');
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from people where id = v_me and discord_id is not null) then
    raise exception 'Link your Discord account before applying';
  end if;
  select * into v_char from characters where id = p_character_id and person_id = v_me;
  if not found then
    raise exception 'That character is not one of yours';
  end if;
  select t.guild_id into v_guild from teams t where t.id = p_team_id and t.archived_at is null for share;
  perform 1 from team_recruiting r
   where r.team_id = p_team_id and r.taking_applications and r.join_method = 'application' and v_guild is not null
     for share;
  if not found then
    raise exception 'That team isn''t taking applications';
  end if;
  if exists (select 1 from recruit_applications a
              where a.team_id = p_team_id and a.person_id = v_me and a.closed_at is null) then
    raise exception 'You already have an open application with this team';
  end if;
  if p_time_zone is not null and not exists (select 1 from pg_timezone_names z where z.name = p_time_zone) then
    raise exception 'That is not a time zone';
  end if;

  -- Other specs: up to four, each a spec of the character's own class other
  -- than the one it is applying as, none twice.
  if cardinality(v_specs) > 4 then
    raise exception 'Pick up to 4 other specs';
  end if;
  if exists (select 1 from unnest(v_specs) s
              where s is null
                 or s = v_char.spec_name
                 or not exists (select 1 from classes_specs cs where cs.class = v_char.class_name and cs.spec = s)) then
    raise exception 'Other specs must be other specs of your character''s class';
  end if;
  if (select count(distinct s) from unnest(v_specs) s) <> cardinality(v_specs) then
    raise exception 'Pick each other spec once';
  end if;

  -- Who sent them. A code is checked here, never trusted from the browser.
  if p_recruiter_code is not null and v_friend is not null then
    raise exception 'A recruiter or a friend sent you, not both';
  elsif p_recruiter_code is not null then
    select r.person_id, r.code, coalesce(guild_person_public_name(r.guild_id, r.person_id), 'A recruiter')
      into v_recruiter, v_code, v_sent_name
      from guild_recruiters r
     where r.guild_id = v_guild and r.code = lower(p_recruiter_code) and r.active and in_guild(r.guild_id, r.person_id);
    if not found then
      raise exception 'That recruiter link isn''t active';
    end if;
    if v_recruiter = v_me then
      raise exception 'You can''t be your own recruiter';
    end if;
    v_sent_by := 'recruiter';
  elsif v_friend is not null then
    if char_length(v_friend) > 100 or v_friend ~ '[\r\n]' then
      raise exception 'A friend''s name is one line of at most 100 characters';
    end if;
    v_sent_by := 'friend';
    v_sent_name := v_friend;
  end if;

  -- The answers, against the questions that are on now.
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answers must be an object';
  end if;
  v_form := team_application_question_list(p_team_id);
  for v_q in
    select q from (
      select s || jsonb_build_object('akey', s ->> 'key') as q, 1 as part, o
        from jsonb_array_elements(v_form -> 'starters') with ordinality as e(s, o)
       where (s ->> 'on')::boolean and s ->> 'answer_type' <> 'recruiter'
      union all
      select s || jsonb_build_object('akey', s ->> 'id'), 2, o
        from jsonb_array_elements(v_form -> 'questions') with ordinality as e(s, o)
    ) x
    order by part, o
  loop
    v_key := v_q ->> 'akey';
    v_a := p_answers -> v_key;
    if v_a is null or v_a = 'null'::jsonb or (jsonb_typeof(v_a) = 'string' and btrim(v_a #>> '{}') = '') then
      if (v_q ->> 'required')::boolean then
        raise exception 'Please answer: %', v_q ->> 'prompt';
      end if;
      continue;
    end if;
    v_text := case when jsonb_typeof(v_a) = 'string' then v_a #>> '{}' end;
    if v_q ->> 'answer_type' = 'yes_no' then
      if jsonb_typeof(v_a) <> 'boolean' then
        raise exception 'Answer yes or no: %', v_q ->> 'prompt';
      end if;
    elsif v_text is null then
      raise exception 'That answer must be text: %', v_q ->> 'prompt';
    elsif v_q ->> 'answer_type' in ('short_text', 'paragraph') then
      v_text := btrim(v_text);
      if char_length(v_text) > (v_q ->> 'max_length')::integer then
        raise exception 'That answer is over % characters: %', v_q ->> 'max_length', v_q ->> 'prompt';
      end if;
    elsif v_q ->> 'answer_type' = 'link' then
      v_text := btrim(v_text);
      if v_text !~ '^https?://\S+$' or char_length(v_text) > 500 then
        raise exception 'That answer must be a link: %', v_q ->> 'prompt';
      end if;
    elsif v_q ->> 'answer_type' = 'choice' then
      if not (v_q -> 'choices') ? v_text then
        raise exception 'That is not one of the choices: %', v_q ->> 'prompt';
      end if;
    elsif v_q ->> 'answer_type' = 'picture' then
      if not starts_with(v_text, p_team_id || '/' || v_uid || '/')
         or not exists (select 1 from storage.objects o
                         where o.bucket_id = 'application-pictures' and o.name = v_text) then
        raise exception 'That picture is not one you uploaded for this team: %', v_q ->> 'prompt';
      end if;
    end if;
    v_answers := v_answers || jsonb_build_array(
      case when v_q ? 'key' then jsonb_build_object('key', v_q ->> 'key')
           else jsonb_build_object('question_id', (v_q ->> 'id')::integer) end
      || jsonb_build_object('label', v_q ->> 'label', 'prompt', v_q ->> 'prompt',
                            'answer_type', v_q ->> 'answer_type',
                            'answer', case when v_text is null then v_a else to_jsonb(v_text) end));
  end loop;
  if exists (select 1 from jsonb_object_keys(p_answers) as k
              where k not in (select a ->> 'key' from jsonb_array_elements(v_answers) a where a ? 'key'
                              union all
                              select a ->> 'question_id' from jsonb_array_elements(v_answers) a where a ? 'question_id')
                and (p_answers -> k) <> 'null'::jsonb
                and not (jsonb_typeof(p_answers -> k) = 'string' and btrim(p_answers ->> k) = '')) then
    raise exception 'An answer is for a question that is not on this form';
  end if;

  begin
    insert into recruit_applications (
      team_id, person_id, source, character_id, name_realm, class_name, spec_name, other_specs, item_level,
      answers, sent_by, recruiter_person_id, recruiter_code, sent_by_name, time_zone)
    values (p_team_id, v_me, 'application', v_char.id, v_char.name_realm, v_char.class_name, v_char.spec_name,
            v_specs, v_char.item_level, v_answers, v_sent_by, v_recruiter, v_code, v_sent_name, p_time_zone)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have an open application with this team';
  end;
  insert into recruit_events (application_id, kind, actor_person_id) values (v_id, 'applied', v_me);
  perform recruit_log(p_team_id, v_me, 'Application Sent', v_id, jsonb_build_object('name_realm', v_char.name_realm));
  return v_id;
end;
$$;

comment on function public.send_application(integer, integer, jsonb, text, text, text, text[]) is
  'Sends an application (#1539, #1547) with one of the caller''s characters, while the team takes applications through the form. p_answers is keyed by starter key or team question id; only questions that are on, every required one answered. p_recruiter_code is checked against the guild''s active recruiters. p_other_specs (#1810): up to 4 other specs of the character''s class. One open application per person per team. Needs a linked Discord account.';

revoke all on function public.send_application(integer, integer, jsonb, text, text, text, text[]) from public, anon;
grant execute on function public.send_application(integer, integer, jsonb, text, text, text, text[]) to authenticated;
