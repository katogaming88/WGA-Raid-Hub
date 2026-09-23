-- #1264: let an officer turn an invite link off outright, not just replace it
-- with a new one.

create or replace function public.team_invite_link_revoke(p_team_id integer)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  delete from public.team_invite_links where team_id = p_team_id;

  perform public.write_audit_log(p_team_id, 'Invite Link Revoked', 'team_invite_links', p_team_id, '{}'::jsonb);
end;
$$;

comment on function public.team_invite_link_revoke(integer) is
  'Deletes a team''s invite code outright, so it stops resolving with no replacement. Officer/team_leader/guild officer/site admin only (#1264).';

revoke all on function public.team_invite_link_revoke(integer) from public;
revoke execute on function public.team_invite_link_revoke(integer) from anon;
grant execute on function public.team_invite_link_revoke(integer) to authenticated;
