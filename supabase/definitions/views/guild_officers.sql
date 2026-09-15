-- View public.guild_officers: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- select (site roles): none

create or replace view public.guild_officers with (security_invoker=on) as
 SELECT g.id,
    p.discord_id,
    p.auth_user_id,
    g.person_id,
    g.created_at
   FROM guild_grants g
     JOIN people p ON p.id = g.person_id
  WHERE g.grant_type = 'guild_officer'::text;
