-- #1674: the "Character Added to Roster" Discord notice is built from the
-- caller's own Audit Log row for the add, not from text the page sends.
-- discord-bot-webhook calls this as the signed-in member, so the read is
-- one the caller makes themselves: audit_log is officers' only, and this
-- hands back nothing but the caller's own newest add_own_character() row on
-- the named team from the last five minutes, with what the notice shows.
-- The window lives here so a caller cannot ask for an older add again.
-- The character must be the caller's own on the roster too, on the row's
-- team: an officer can write any audit row through write_audit_log(), detail
-- included, and a guild officer on any team, so the wording alone does not
-- prove add_own_character() wrote it (CodeRabbit and the fresh review on
-- #1677). A character or Member taken off the roster since is not announced.

create function public.my_recent_own_add(p_team_slug text)
returns table (
  audit_id integer,
  team_slug text,
  member text,
  name_realm text,
  class_spec text,
  added_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- add_own_character() writes detail as the spec label followed by this.
  select a.id,
         t.slug,
         n.label,
         p.name_realm,
         left(a.detail #>> '{}', -length(', added by the member')),
         a.created_at
    from public.audit_log a
    join public.teams t on t.id = a.team_id
    join public.players p on p.id = a.target_id
    join public.team_members tm on tm.id = p.team_member_id
    left join public.names n on n.team_member_id = p.team_member_id
   where a.actor_id = auth.uid()
     and tm.person_id = public.my_person_id()
     and p.team_id = a.team_id
     and p.archived_at is null
     and tm.archived_at is null
     and t.slug = p_team_slug
     and a.action = 'Player Added'
     and a.target_type = 'players'
     and a.detail #>> '{}' like '%, added by the member'
     and a.created_at >= now() - interval '5 minutes'
   order by a.created_at desc
   limit 1;
$$;

comment on function public.my_recent_own_add(text) is
  'The caller''s own newest Add character row on the team from the last five minutes (#1674): audit id, team slug, Member name, character, spec label and when. discord-bot-webhook builds the officers'' "Character Added to Roster" notice from it, as the caller. No row for anyone else''s adds, an officer''s add, a row about a character not the caller''s own, another team, a character or Member taken off the roster since, or an older add.';

revoke all on function public.my_recent_own_add(text) from public;
revoke execute on function public.my_recent_own_add(text) from anon;
grant execute on function public.my_recent_own_add(text) to authenticated;
