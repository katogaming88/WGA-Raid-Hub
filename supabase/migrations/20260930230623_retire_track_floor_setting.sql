-- #1267: the track floors leave team_settings.config.
--
-- Since 20260930203517 they are season_track_floors rows and the gear sync
-- reads those, so the trackIlvlThresholds key two teams held has no reader,
-- and the Admin card that wrote it is gone with this release. A page still
-- open on the old bundle shows the card with its prefilled values, and a Save
-- there writes the key back, which nothing reads; the acceptance count is
-- read after the browser cache has turned over.

update public.team_settings
set config = config - 'trackIlvlThresholds'
where config ? 'trackIlvlThresholds';
