-- #1226 / #1324: a guild or team name is a label, not an identity.
--
-- A guild is identified by its url_key and a team by its slug (both random
-- codes, #1114), and everything else by id. The names only exist to be shown,
-- yet two rules treated them as identities: no two guilds could share a name,
-- and no two teams could share one anywhere on the site. That stops a second
-- guild having a team called "Phoenix" (or two guilds both called "We Go
-- Again" on different realms), which is what guild creation (#1226) needs.
--
-- Guild names may now repeat. A team's name has to be unique only within its
-- own guild, case-insensitively, so one guild cannot have two teams both
-- called Phoenix, while "WGA Team 1" and "WGA Team 2" are different names.
--
-- The four teams on production have no repeated name within a guild, so the
-- new index applies cleanly.

alter table public.guilds drop constraint guilds_name_key;
alter table public.teams drop constraint teams_name_key;

create unique index teams_guild_id_lower_name_key on public.teams (guild_id, lower(name));

comment on column public.guilds.name is
  'The guild''s display name. A label only: guilds are identified by url_key and id, so two guilds may share a name (#1226).';
comment on column public.teams.name is
  'The team''s display name. Unique within its guild, ignoring case, so a guild cannot have two teams with the same name; other guilds may reuse it (#1226).';
