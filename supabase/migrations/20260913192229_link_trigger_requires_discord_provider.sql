-- #1118: link_auth_user_to_member() links grant rows only for a Discord signup.
--
-- The trigger fills auth_user_id on any unlinked row in team_members,
-- site_admins, guild_officers or boe_managers whose discord_id matches the new
-- account's raw_user_meta_data ->> 'provider_id'. That column is supplied by
-- whoever creates the account rather than by the identity provider, so the
-- trigger was deciding who holds a grant on an unverified value: an email
-- signup carrying somebody's Discord snowflake inherited their grant, role and
-- all. raw_app_meta_data is service-role-only and GoTrue stamps the provider
-- into it at insert, so it is the half of the auth row that can be trusted.
--
-- One early return rather than a fourth condition on each update, so a fifth
-- grant table added later is covered without anyone remembering. Insert-only
-- on purpose: a repeat OAuth sign-in updates raw_app_meta_data rather than
-- inserting, so firing on update would run this on every sign-in.
--
-- Every account on production already reads 'discord', so no existing link
-- changes. Sibling of #1117, which closed the other route to the same outcome.

create or replace function public.link_auth_user_to_member()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  -- Only the provider writes raw_app_meta_data. The provider_id below is the
  -- account's own to set, so without this the match proves nothing.
  if new.raw_app_meta_data ->> 'provider' is distinct from 'discord' then
    return new;
  end if;

  update team_members
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update site_admins
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update boe_managers
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update guild_officers
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  return new;
end;
$$;
