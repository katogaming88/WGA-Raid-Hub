-- #942 step 4: a raider's notification inbox belongs to the person, not to their current character.
--
-- A notification is addressed to a character (notifications.player_id). The
-- read rule matched only the caller's active characters, so after a main swap
-- every notification on the old character disappeared from their bell, while
-- #941 kept the old character linked to them. Kat's call (2026-09-15): the
-- inbox belongs to the person, so it shows every character they hold,
-- archived ones included.
--
-- The rows stay addressed to characters; no person_id column. The rule is what
-- decides whose inbox a row is in, and it now asks the person.
--
-- Existing notifications on archived characters are marked read here (21 on
-- production on 2026-09-15, 6 unread, 12 held by someone who can still sign
-- in). Otherwise those people would see a bell badge for old messages about a
-- character they swapped away from. Only notifications on characters archived
-- from now on arrive unread.
--
-- Not in this step, also Kat's call: account_preferences stays keyed by the
-- sign-in account. The account id does not change when Battle.net and Discord
-- are linked to it, and its column is not one cutover drops, so moving it would
-- change the sign-in code on both sites for nothing.

-- Every character the caller's person holds, archived included. The inbox's
-- counterpart to my_active_player_ids(), which every write rule on a
-- character's own rows keeps using, so an archived character's wishlist and
-- the rest stay read-only.
create or replace function public.my_player_ids() returns integer[]
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(p.id), '{}')
    from players p
    join team_members tm on tm.id = p.team_member_id
   where tm.person_id = my_person_id();
$$;

revoke all on function public.my_player_ids() from public;
grant execute on function public.my_player_ids() to anon, authenticated;

update public.notifications n
   set read = true
  from public.players p
 where p.id = n.player_id
   and p.archived_at is not null
   and not n.read;

drop policy "Raiders read own notifications" on public.notifications;
create policy "Raiders read own notifications" on public.notifications
  for select
  using (player_id = any ((select public.my_player_ids())::integer[]));

-- Marking read is the only raider write. The check repeats the ownership test
-- so a row cannot be moved into someone else's inbox in the same update.
drop policy "Raiders mark own notifications read" on public.notifications;
create policy "Raiders mark own notifications read" on public.notifications
  for update
  using (player_id = any ((select public.my_player_ids())::integer[]))
  with check (player_id = any ((select public.my_player_ids())::integer[]));
