-- #1135: the grant link trigger moves from auth.users to auth.identities.
--
-- link_auth_user_to_member() fills auth_user_id on any unlinked row in
-- team_members, site_admins, guild_officers or boe_managers whose discord_id
-- matches the account's Discord id. It has always taken that id from
-- raw_user_meta_data ->> 'provider_id', a column the account itself can write,
-- so it was deciding who holds a grant on an unverified value.
--
-- #1118 guarded that by requiring raw_app_meta_data ->> 'provider' = 'discord',
-- which is service-role-only and correct as far as it goes. It left the
-- forgeable column being read, because a trigger on auth.users has nothing
-- better available: GoTrue inserts the auth.users row first and the
-- auth.identities row after it, in the same transaction, so at users-insert
-- time the identity row does not exist yet. That ordering is the whole reason
-- the guard had to be indirect.
--
-- On auth.identities there is nothing to guard. new.provider says which
-- provider proved this, new.provider_id is the id that provider gave, and
-- new.user_id is the account, all of them written by the OAuth exchange and
-- none of them by the account. The trigger reads the row it fired on.
--
-- This is also the shape #942's people table wants: a verified external
-- identity appears, and the grants naming it attach to the person holding it.
--
-- Insert-only, as before. A repeat sign-in updates auth.identities rather than
-- inserting, so firing on update would run this on every login.
--
-- Behaviour on production is unchanged: all 73 accounts have exactly one
-- identity row, provider discord, and their metadata agrees with it (measured
-- 2026-09-13). What changes is that an auth.users row is no longer proof of
-- anything on its own.

create or replace function public.link_auth_user_to_member()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  -- Only a Discord identity links a Discord-keyed grant. One early return
  -- rather than a condition on each update, so a fifth grant table added later
  -- is covered without anyone remembering.
  if new.provider is distinct from 'discord' then
    return new;
  end if;

  update team_members
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update site_admins
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update boe_managers
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  update guild_officers
  set auth_user_id = new.user_id
  where discord_id = new.provider_id
    and auth_user_id is null;

  return new;
end;
$$;

comment on function public.link_auth_user_to_member() is
  'Links unlinked grant rows to the account whose Discord identity just appeared (#211, #910, #1118, #1135). Fires on auth.identities insert, so provider and provider_id are the provider''s own words rather than account-writable metadata.';

-- The old trigger goes with it. Leaving both would double every update and,
-- worse, keep a path that links on metadata alone.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_identity_created
  after insert on auth.identities
  for each row execute function public.link_auth_user_to_member();
