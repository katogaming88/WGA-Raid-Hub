-- #1264: per-team invite links, one active link per team.
--
-- An officer generates/resets a link and sets how long it lasts; opening the
-- link (public, before sign-in) resolves it to the team and guild it belongs
-- to. Joining onto the roster from a resolved link is a later PR -- this one
-- is just the code, its expiry, and reset.

create table public.team_invite_links (
  team_id integer primary key references public.teams (id) on delete cascade,
  code text not null unique,
  expires_at timestamp with time zone,
  updated_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint team_invite_links_code_format check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.team_invite_links is
  'One active invite code per team (#1264). Resetting overwrites the row, so the old code stops resolving immediately.';

alter table public.team_invite_links enable row level security;

create trigger trg_team_invite_links_updated_at
  before update on public.team_invite_links
  for each row execute function public.set_updated_at();

create policy "Claude readers read team_invite_links" on public.team_invite_links
  for select to claude_readers using (true);

-- No public read: the code is a bearer credential, not a lookup value.
-- Officers/leader see it to display and copy it in team settings; guild
-- officers get the same cross-team reach #607 gives them elsewhere.
create policy "Officers read team_invite_links" on public.team_invite_links
  for select using (
    team_id = any ((select public.my_officer_team_ids())::integer[])
    or (select public.is_site_admin())
    or (select public.is_guild_officer())
  );

-- No insert/update/delete policies: every write goes through
-- team_invite_link_reset() below, so a code is always server-generated.

create or replace function public.team_invite_link_reset(p_team_id integer, p_expires_at timestamp with time zone default null)
returns public.team_invite_links
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_slug text;
  v_row public.team_invite_links;
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  select slug into v_slug from public.teams where id = p_team_id;
  if v_slug is null then
    raise exception 'Team not found';
  end if;

  insert into public.team_invite_links (team_id, code, expires_at)
  values (p_team_id, v_slug || '-' || substr(public.new_url_code(), 1, 6), p_expires_at)
  on conflict (team_id) do update
    set code = excluded.code,
        expires_at = excluded.expires_at
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.team_invite_link_reset(integer, timestamp with time zone) is
  'Generates (or regenerates) a team''s invite code and sets its expiry (null = no expiry), invalidating any old code. Officer/team_leader/guild officer/site admin only (#1264).';

revoke all on function public.team_invite_link_reset(integer, timestamp with time zone) from public;
revoke execute on function public.team_invite_link_reset(integer, timestamp with time zone) from anon;
grant execute on function public.team_invite_link_reset(integer, timestamp with time zone) to authenticated;

-- Resolves a code to its team and guild for the public /join/<code> page,
-- before the visitor has signed in. Empty result on a reset, expired, or
-- unknown code -- the join page reads that as "this link doesn't work".
create or replace function public.team_invite_link_resolve(p_code text)
returns table(team_id integer, team_name text, team_slug text, guild_id integer, guild_name text)
language sql stable security definer set search_path to 'public'
as $$
  select t.id, t.name, t.slug, g.id, g.name
  from public.team_invite_links l
  join public.teams t on t.id = l.team_id
  join public.guilds g on g.id = t.guild_id
  where l.code = p_code
    and (l.expires_at is null or l.expires_at > now());
$$;

comment on function public.team_invite_link_resolve(text) is
  'Team and guild an invite code currently resolves to, or no rows if reset/expired/unknown. Public: called before sign-in (#1264).';

revoke all on function public.team_invite_link_resolve(text) from public;
grant execute on function public.team_invite_link_resolve(text) to anon;
grant execute on function public.team_invite_link_resolve(text) to authenticated;
