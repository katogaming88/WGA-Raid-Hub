-- #1550: a recruiter's own link code, for the My recruits page.
-- guild_recruiter_list() is for the Members tab and needs manage_recruiters,
-- so a recruiter who is not an Admin had no way to read their own code, or to
-- know they are one. This returns the caller's code in a guild, or null when
-- they are not a recruiter there, are switched off, or have left the guild:
-- the same test the apply form uses to credit a link.

create function public.my_recruiter_code(p_guild_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return (select r.code
            from guild_recruiters r
           where r.guild_id = p_guild_id and r.person_id = my_person_id()
             and r.active and in_guild(r.guild_id, r.person_id));
end;
$$;

comment on function public.my_recruiter_code(integer) is
  'The caller''s own recruiter link code in a guild (#1550), or null when they are not a recruiter there, are switched off, or have left. Only ever the caller''s own row.';

revoke all on function public.my_recruiter_code(integer) from public, anon;
grant execute on function public.my_recruiter_code(integer) to authenticated;

-- My recruits also shows each person's class and spec, and the recruiter's
-- own notes on them (never an officer's), so the page is one read instead of
-- one per person. The same columns as before, plus these.
create or replace function public.my_recruits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me integer := my_person_id();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'team_id', a.team_id,
             'guild_id', t.guild_id,
             'team_name', t.name,
             'name', case when a.person_id is not null then guild_person_name(t.guild_id, a.person_id) end,
             'name_realm', a.name_realm,
             'class_name', a.class_name,
             'spec_name', a.spec_name,
             'status', a.status,
             'applied_at', a.applied_at,
             'closed_at', a.closed_at,
             'trial_starts_on', a.trial_starts_on,
             'trial_ends_on', a.trial_ends_on,
             'notes', coalesce((
               select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at)
                                order by n.created_at, n.id)
                 from recruit_notes n
                where n.application_id = a.id and n.author_person_id = v_me), '[]'::jsonb))
             order by a.applied_at desc, a.id desc)
      from recruit_applications a
      join teams t on t.id = a.team_id
     where a.recruiter_person_id = v_me and in_guild(t.guild_id, v_me)), '[]'::jsonb);
end;
$$;

comment on function public.my_recruits() is
  'The people the caller sent as a recruiter (#1539, #1550), in guilds they are still in: name, class and spec, team and guild, status and dates, with the caller''s own notes on each (never an officer''s).';
