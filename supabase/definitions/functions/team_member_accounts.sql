-- Function public.team_member_accounts: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.team_member_accounts(p_team_id integer)
 RETURNS TABLE(team_member_id integer, battlenet boolean, battletag text, discord boolean, discord_username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    public.has_team_permission(p_team_id, 'edit_roster')
    or public.is_site_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    tm.id,
    bn.user_id is not null,
    nullif(bn.identity_data -> 'custom_claims' ->> 'battletag', ''),
    tm.discord_id is not null,
    coalesce(
      nullif(dc.identity_data ->> 'full_name', ''),
      nullif(regexp_replace(dc.identity_data ->> 'name', '#0$', ''), '')
    )
  from public.team_members tm
  left join public.people pe on pe.id = tm.person_id
  left join lateral (
    select i.user_id, i.identity_data
    from auth.identities i
    where i.user_id = pe.auth_user_id and i.provider = 'custom:battlenet'
    order by i.created_at desc
    limit 1
  ) bn on true
  left join lateral (
    select i.identity_data
    from auth.identities i
    where i.user_id = pe.auth_user_id and i.provider = 'discord'
    order by i.created_at desc
    limit 1
  ) dc on true
  where tm.team_id = p_team_id
    and tm.archived_at is null
  order by tm.id;
end;
$function$;
