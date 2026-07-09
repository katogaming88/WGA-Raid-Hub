-- Audit log write path (#214, Phase 4).
--
-- audit_log has no client write path (tests/rls/write-policies.test.js):
-- anon/authenticated only hold REFERENCES,TRIGGER,TRUNCATE,MAINTAIN on the
-- table, no INSERT. This SECURITY DEFINER function is meant to be the only
-- way a row ever gets written, so every Phase 5 officer write feature that
-- calls it is guaranteed an audit trail from day one. Same definer pattern as
-- is_site_admin(), link_auth_user_to_member(), and claim_character() (#212,
-- #366): plpgsql, set search_path to 'public', identity via auth.uid()
-- directly.
--
-- Role gate uses 'officer'/'team_leader' (#294's rename of the old 'admin'
-- value), matching every other officer-tier policy in this schema.
create or replace function public.write_audit_log(
  p_team_id integer,
  p_action text,
  p_target_type text default null,
  p_target_id integer default null,
  p_detail jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_audit_log(integer, text, text, integer, jsonb) from public;
revoke execute on function public.write_audit_log(integer, text, text, integer, jsonb) from anon;
grant execute on function public.write_audit_log(integer, text, text, integer, jsonb) to authenticated;
