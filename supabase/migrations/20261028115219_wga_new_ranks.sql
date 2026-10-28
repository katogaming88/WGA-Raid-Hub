-- #1648: We Go Again's people get their new ranks (#1517, "What this means
-- for We Go Again at cutover"), now rather than at cutover, so the guild
-- test's testers have them.
--
-- #1645 already did most of it: each team's team leader is its Team Owner,
-- officers are Officers, raiders are Raiders, nobody is an Assistant, and
-- the two guild officers are Admins. What is left:
--
--   * Kat is the guild's Owner.
--   * Rex, Staff (site_admin), is also an Admin so he keeps recording BoE
--     sales. Both site admins are named by their grant rather than by id,
--     and Kat's Admin row then becomes Owner.
--
-- boe_manager grants are kept until cutover for the current site; they mean
-- nothing in the new app. guild_ranks_keep_grant gives each new Owner and
-- Admin the guild_officer grant the current site reads.
--
-- Every team has exactly one team leader (Kat, 2026-10-28; production
-- agrees), and #1645 made that one the Team Owner. Should a second appear,
-- team_members_keep_rank_and_role already makes them an Officer.

insert into public.guild_ranks (guild_id, person_id, rank)
select guild_id, person_id, 'admin'
  from public.guild_grants
 where grant_type = 'site_admin'
on conflict (guild_id, person_id) do update set rank = 'admin'
 where guild_ranks.rank in ('member', 'team_lead');

update public.guild_ranks r
   set rank = 'owner'
  from public.people p, public.guilds g
 where r.person_id = p.id and r.guild_id = g.id
   and p.discord_id = '273131249344708611' and g.url_key = 'wga';

-- On production Kat is there; locally and in CI the seed runs after the
-- migrations, so nobody is, and the seed sets its own Owner.
do $$
begin
  if exists (select 1 from public.team_members)
     and not exists (select 1 from public.guild_ranks r join public.guilds g on g.id = r.guild_id
                      where g.url_key = 'wga' and r.rank = 'owner') then
    raise exception 'We Go Again has no Owner: Kat was not found (#1648)';
  end if;
end;
$$;
