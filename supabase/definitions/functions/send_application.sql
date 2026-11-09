-- Function public.send_application: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.send_application(p_team_id integer, p_character_id integer, p_answers jsonb, p_recruiter_code text, p_friend_name text, p_time_zone text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      team_id, person_id, source, character_id, name_realm, class_name, spec_name, item_level,
      answers, sent_by, recruiter_person_id, recruiter_code, sent_by_name, time_zone)
    values (p_team_id, v_me, 'application', v_char.id, v_char.name_realm, v_char.class_name, v_char.spec_name,
            v_char.item_level, v_answers, v_sent_by, v_recruiter, v_code, v_sent_name, p_time_zone)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have an open application with this team';
  end;
  insert into recruit_events (application_id, kind, actor_person_id) values (v_id, 'applied', v_me);
  perform recruit_log(p_team_id, v_me, 'Application Sent', v_id, jsonb_build_object('name_realm', v_char.name_realm));
  return v_id;
end;
$function$;
