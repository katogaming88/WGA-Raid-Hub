-- Discord display name resolution for the Roster tab's Discord Claims list.
--
-- resolve_actor_name() (#376) exists already, but its priority order is
-- wrong for this: it prefers the linked character's nickname/name over the
-- raw Discord display name, since it's built for the audit log's CHANGED BY
-- column where "who did this" should read as a person's raid identity. The
-- Discord Claims list needs the opposite -- officers reviewing claims want
-- to verify the actual Discord account behind a claim, which is exactly the
-- thing the character-name-first priority would hide. Small dedicated
-- function instead of overloading resolve_actor_name with a mode flag.
--
-- Same SECURITY DEFINER shape and gate as resolve_actor_name()/
-- write_audit_log(): the Discord display name is auth.users PII not exposed
-- to anon/authenticated directly, so this re-checks the same officer/
-- team_leader-or-site-admin gate that already governs who can see the
-- Discord Claims list itself.
create or replace function public.resolve_discord_display_name(p_actor_id uuid, p_team_id integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  into v_display
  from auth.users u
  where u.id = p_actor_id;

  return v_display;
end;
$$;

revoke all on function public.resolve_discord_display_name(uuid, integer) from public;
revoke execute on function public.resolve_discord_display_name(uuid, integer) from anon;
grant execute on function public.resolve_discord_display_name(uuid, integer) to authenticated;
