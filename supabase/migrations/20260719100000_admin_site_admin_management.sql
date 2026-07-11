-- Site admin dashboard, stage 2 (#232): grant/revoke site admin access.
--
-- Same SECURITY DEFINER + is_site_admin() gate as the stage 1 team CRUD
-- functions (20260718100000_admin_team_management.sql). site_admins has no
-- direct client write grant, same as teams -- these are that write path.
--
-- Grant tries to resolve auth_user_id immediately (matching an existing
-- auth.users row by Discord snowflake via raw_user_meta_data->>'provider_id',
-- same lookup the on_auth_user_created trigger/link_auth_user_to_member()
-- uses) so granting an already-registered account takes effect without
-- waiting on their next login. A brand new grant with no matching
-- auth.users row yet is still fine -- link_auth_user_to_member() backfills
-- auth_user_id the first time that Discord account signs in.
--
-- audit_log.team_id is dropped to nullable here because site admin grants
-- aren't scoped to any one team; write_audit_log(null, ...) already reads as
-- "site-admin-only" under the existing "Officers read audit_log" access rule
-- (my_team_role(null) resolves to no row -> false, so only the is_site_admin()
-- branch of that USING clause can see it) with no access rule changes needed.

alter table public.audit_log alter column team_id drop not null;

create or replace function public.admin_list_site_admins()
returns table (id integer, discord_id text, auth_user_id uuid, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  return query
    select s.id, s.discord_id, s.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from public.site_admins s
    left join auth.users u on u.id = s.auth_user_id
    order by s.id;
end;
$$;

create or replace function public.admin_grant_site_admin(
  p_discord_id text
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

  if exists (select 1 from public.site_admins where discord_id = p_discord_id) then
    raise exception 'That Discord account already has site admin access';
  end if;

  insert into public.site_admins (discord_id, auth_user_id)
  values (
    p_discord_id,
    (select id from auth.users where raw_user_meta_data ->> 'provider_id' = p_discord_id limit 1)
  )
  returning id into v_id;

  perform public.write_audit_log(null, 'site_admin_granted', 'site_admin', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_revoke_site_admin(
  p_discord_id text
)
returns void
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

  if (select count(*) from public.site_admins) <= 1 then
    raise exception 'Cannot revoke the last remaining site admin';
  end if;

  delete from public.site_admins where discord_id = p_discord_id
  returning id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have site admin access';
  end if;

  perform public.write_audit_log(null, 'site_admin_revoked', 'site_admin', v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$$;

revoke all on function public.admin_list_site_admins() from public;
revoke execute on function public.admin_list_site_admins() from anon;
grant execute on function public.admin_list_site_admins() to authenticated;

revoke all on function public.admin_grant_site_admin(text) from public;
revoke execute on function public.admin_grant_site_admin(text) from anon;
grant execute on function public.admin_grant_site_admin(text) to authenticated;

revoke all on function public.admin_revoke_site_admin(text) from public;
revoke execute on function public.admin_revoke_site_admin(text) from anon;
grant execute on function public.admin_revoke_site_admin(text) to authenticated;
