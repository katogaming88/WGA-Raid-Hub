-- Site admin dashboard, stage 1 (#232): team create/edit/archive.
--
-- teams has no client write path today (same REFERENCES/TRIGGER/TRUNCATE/
-- MAINTAIN-only grant as every other table meant to be written through a
-- SECURITY DEFINER RPC -- see write_audit_log's comment for the pattern).
-- These functions are that write path, gated on is_site_admin() the same way
-- write_audit_log() gates officer writes on my_team_role().
--
-- archived_at follows the players.archived_at convention (nullable
-- timestamptz, null = active) rather than a boolean, so "when" is preserved.

alter table public.teams add column if not exists archived_at timestamptz;

create or replace function public.admin_create_team(
  p_name text,
  p_slug text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  insert into public.teams (name, slug)
  values (p_name, p_slug)
  returning id into v_id;

  -- Every other write path (set_team_setting, fetchSupabaseSettings) assumes
  -- a team_settings row already exists and errors/returns null otherwise; a
  -- team created here would have no row until someone happened to write to
  -- it first.
  insert into public.team_settings (team_id, config) values (v_id, '{}'::jsonb);

  perform public.write_audit_log(v_id, 'team_created', 'team', v_id, jsonb_build_object('name', p_name, 'slug', p_slug));

  return v_id;
end;
$$;

create or replace function public.admin_update_team(
  p_team_id integer,
  p_name text,
  p_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.teams set name = p_name, slug = p_slug where id = p_team_id;

  perform public.write_audit_log(p_team_id, 'team_updated', 'team', p_team_id, jsonb_build_object('name', p_name, 'slug', p_slug));
end;
$$;

create or replace function public.admin_set_team_archived(
  p_team_id integer,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.teams
  set archived_at = case when p_archived then now() else null end
  where id = p_team_id;

  perform public.write_audit_log(
    p_team_id,
    case when p_archived then 'team_archived' else 'team_unarchived' end,
    'team',
    p_team_id,
    null
  );
end;
$$;

revoke all on function public.admin_create_team(text, text) from public;
revoke execute on function public.admin_create_team(text, text) from anon;
grant execute on function public.admin_create_team(text, text) to authenticated;

revoke all on function public.admin_update_team(integer, text, text) from public;
revoke execute on function public.admin_update_team(integer, text, text) from anon;
grant execute on function public.admin_update_team(integer, text, text) to authenticated;

revoke all on function public.admin_set_team_archived(integer, boolean) from public;
revoke execute on function public.admin_set_team_archived(integer, boolean) from anon;
grant execute on function public.admin_set_team_archived(integer, boolean) to authenticated;
