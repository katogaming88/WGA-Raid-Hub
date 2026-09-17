-- #1102: a guild records its region and home realm.
--
-- The new app's Guild home links to the guild on Raider.IO and the Armory.
-- Both addresses are built from the region, the realm and the guild's name,
-- which today live only as two hard-coded WGA links in js/common.js. Keeping
-- them on the guild row means another guild's page links to its own guild
-- rather than to WGA. Both are optional: a guild without them shows no links.
-- The existing public read on guilds already covers the new columns.

alter table public.guilds
  add column region text,
  add column realm text,
  add constraint guilds_region_format check (region in ('us', 'eu', 'kr', 'tw')),
  add constraint guilds_realm_not_blank check (length(btrim(realm)) > 0);

comment on column public.guilds.region is
  'Battle.net region, lower case (us, eu, kr, tw). With realm, builds the guild''s Raider.IO and Armory links (#1102).';
comment on column public.guilds.realm is
  'Home realm as the game spells it (Tichondrius). Null when not set; the links are then left out (#1102).';

update public.guilds set region = 'us', realm = 'Tichondrius' where url_key = 'wga';
