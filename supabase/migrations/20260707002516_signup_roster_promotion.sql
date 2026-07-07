-- Signup-to-roster promotion (pending roster stage).
--
-- "Pending roster" is a season_signups state, not a players flag:
-- status 'approved' with approved_player_id NULL means the signup is
-- approved but not yet on the official roster. No players row exists
-- until an officer runs add_signup_to_roster(). This keeps applicant
-- data officer-only under existing RLS (players is public-read) and
-- keeps the lifecycle in a single source of truth.

-- Invariant: a signup may only link to a player once it is 'added'.
-- One-directional on purpose: the FK's ON DELETE SET NULL may null
-- approved_player_id on an 'added' row without violating this.
alter table public.season_signups
  add constraint season_signups_player_only_when_added
  check (approved_player_id is null or status = 'added');

-- Atomic promotion: approved signup -> players row -> status 'added'.
-- SECURITY INVOKER: authorization comes from existing RLS. Officers and
-- team leaders have full write on players and update on season_signups;
-- anyone else fails on the inner writes.
create or replace function public.add_signup_to_roster(
  p_signup_id integer,
  p_is_trial boolean default true,
  p_archive_player_id integer default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_signup public.season_signups%rowtype;
  v_player_id integer;
begin
  select * into v_signup from public.season_signups
   where id = p_signup_id for update;
  if not found then
    raise exception 'signup % not found', p_signup_id;
  end if;
  if v_signup.status is distinct from 'approved' then
    raise exception 'signup % is not in approved status (is %)',
      p_signup_id, v_signup.status;
  end if;

  -- Three cases on (team_id, name_realm):
  --   new character            -> plain insert
  --   returning archived char  -> unarchive, refresh trial/join_date/spec
  --   already-active member    -> link + spec update only; keep their
  --                               existing is_trial and join_date
  insert into public.players (team_id, name_realm, class_spec_id, is_trial, join_date)
  values (v_signup.team_id, v_signup.signup_name_realm,
          coalesce(v_signup.swap_class_spec_id, v_signup.class_spec_id),
          p_is_trial, current_date)
  on conflict (team_id, name_realm) do update
    set class_spec_id = excluded.class_spec_id,
        is_trial  = case when players.archived_at is not null
                         then excluded.is_trial else players.is_trial end,
        join_date = case when players.archived_at is not null
                         then excluded.join_date else players.join_date end,
        archived_at = null
  returning id into v_player_id;

  -- Main swap: archive the old character. Team-scoped so an officer
  -- cannot archive another team's player through this parameter.
  if p_archive_player_id is not null then
    update public.players set archived_at = now()
     where id = p_archive_player_id and team_id = v_signup.team_id;
  end if;

  update public.season_signups
     set status = 'added', approved_player_id = v_player_id
   where id = p_signup_id;

  return v_player_id;
end $$;

revoke execute on function public.add_signup_to_roster(integer, boolean, integer)
  from public, anon;
grant execute on function public.add_signup_to_roster(integer, boolean, integer)
  to authenticated;

-- Officer worklist: approved signups awaiting the roster add.
-- security_invoker is load-bearing: the view must run with the caller's
-- privileges so season_signups RLS applies (anon and raiders see nothing,
-- officers see their own team).
create view public.pending_roster
with (security_invoker = on)
as
select s.id as signup_id, s.team_id, s.season, s.signup_name_realm,
       coalesce(s.swap_class_spec_id, s.class_spec_id) as class_spec_id,
       cs.class, cs.spec, cs.role,
       s.off_specs, s.main_swap, s.player_note, s.signup_officer_note,
       s.reviewed_at, s.reviewed_by
from public.season_signups s
left join public.classes_specs cs
  on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
where s.status = 'approved' and s.approved_player_id is null;

grant select on public.pending_roster to anon, authenticated;
