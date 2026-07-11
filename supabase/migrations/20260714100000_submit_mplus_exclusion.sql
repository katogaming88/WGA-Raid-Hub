-- M+ exclusion request write path (#405).
--
-- Unlike bis_requests (#404), mplus_exclusion_requests already fits the live
-- feature exactly (reason/raiderio_url/status match submitMPlusExclusion's
-- payload one-to-one) -- it just never got an INSERT path or any frontend
-- reference at all. Confirmed 0 rows in production before writing this.
--
-- SECURITY DEFINER, granted to anon: submitMPlusExclusionForm runs
-- unauthenticated on the public roster page, same trust model as the GAS
-- action it replaces. Re-validates mPlusExclusionsOpen server-side rather
-- than trusting the client's decision to show the form. The
-- mplus_excl_one_pending_per_player partial unique index (already in the
-- schema) does double duty as the "already has a pending request" guard --
-- a second submission while one is pending surfaces as a unique-violation
-- error to the caller, same as any other unique-constraint failure in this
-- app.
create or replace function public.submit_mplus_exclusion(
  p_team_id integer,
  p_name_realm text,
  p_raiderio_url text default null,
  p_reason text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_player_id integer;
  v_request_id integer;
begin
  select config into v_config from public.team_settings where team_id = p_team_id;
  if not coalesce((v_config->>'mPlusExclusionsOpen')::boolean, false) then
    raise exception 'M+ exclusion requests are not open for this team';
  end if;

  select id into v_player_id
  from public.players
  where team_id = p_team_id and name_realm = p_name_realm and archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  insert into public.mplus_exclusion_requests (team_id, player_id, reason, raiderio_url, status)
  values (p_team_id, v_player_id, nullif(p_reason, ''), nullif(p_raiderio_url, ''), 'pending')
  returning id into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.submit_mplus_exclusion(integer, text, text, text) from public;
grant execute on function public.submit_mplus_exclusion(integer, text, text, text) to anon, authenticated;
