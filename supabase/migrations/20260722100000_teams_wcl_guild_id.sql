-- Per-team WarcraftLogs guild ID (#223, stage 1).
--
-- GAS hardcodes this per-deployment (gs/Config.gs: GUILD_TAG_ID = 801219,
-- Phoenix's guild only -- each team has always run its own separate GAS
-- deployment). The new wcl-sync Edge Function is one shared multi-tenant
-- function, so it needs a per-team lookup instead. Nullable: a team with no
-- WCL guild configured (e.g. Immolation, no GAS backend ever existed for it)
-- simply can't use wcl-sync yet -- the function errors clearly on a null
-- lookup rather than silently querying the wrong guild.
--
-- No new access rule needed: teams already has "Public read teams" (USING
-- (true)), and the only write path is admin_create_team/admin_update_team
-- (SECURITY DEFINER, is_site_admin()-gated, #232) -- this column isn't
-- surfaced there yet, so for now it's set directly via the SQL Editor same
-- as every other one-off admin value in this schema.

alter table public.teams add column if not exists wcl_guild_id integer;
