-- #1133: the Roster tab's re-add brings an archived character back in one
-- call, keeping why they left.
--
-- The re-add was three client writes: an update of the character, a second
-- write clearing its removal reason that hid its own failure, and the audit
-- entry. A removal's reason is never lost now (#1427), and any officer action
-- that brings someone back restores their archived membership (Option 2 on
-- #1355), which officers cannot do with their own rights. So the re-add is
-- one function: it runs with the officer's rights like archive_player(), and
-- the membership comes back through restore_team_member(), run as its owner.

create function public.restore_player(
  p_player_id integer,
  p_name_realm text default null,
  p_nickname text default null,
  p_class_spec_id integer default null,
  p_is_trial boolean default null,
  p_join_date date default null
)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare
  v_team_id integer;
  v_team_member_id integer;
  v_name_realm text;
  v_restored boolean := false;
  v_spec_label text;
begin
  select team_id, team_member_id, name_realm
    into v_team_id, v_team_member_id, v_name_realm
    from public.players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Player % not found', p_player_id;
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false)
          or public.is_guild_officer()
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  -- Asked about every linked character, not only one whose membership reads
  -- as archived: it locks the membership before the character is written, the
  -- order archive_team_member() takes, so an archive cannot land between this
  -- function's read and its update.
  if v_team_member_id is not null then
    v_restored := public.restore_team_member(v_team_id, v_team_member_id);
  end if;

  -- A blank field keeps what the character had. Only the spelling of the name
  -- may change, and the link must still be the one read above, or the
  -- membership just restored would belong to someone else.
  update public.players
     set name_realm = coalesce(nullif(p_name_realm, ''), name_realm),
         nickname = coalesce(nullif(p_nickname, ''), nickname),
         class_spec_id = coalesce(p_class_spec_id, class_spec_id),
         is_trial = coalesce(p_is_trial, is_trial),
         join_date = coalesce(p_join_date, join_date),
         is_bench = false,
         archived_at = null
   where id = p_player_id
     and archived_at is not null
     and name_realm_key = coalesce(lower(replace(nullif(p_name_realm, ''), ' ', '')), name_realm_key)
     and team_member_id is not distinct from v_team_member_id;

  if not found then
    if exists (select 1 from public.players where id = p_player_id and archived_at is null) then
      raise exception '% is already on the roster', v_name_realm;
    end if;
    raise exception 'That name is not this character''s, or the character changed while being re-added';
  end if;

  select concat_ws(' ', cs.class, cs.spec, cs.role) into v_spec_label
    from public.players p
    join public.classes_specs cs on cs.id = p.class_spec_id
   where p.id = p_player_id;

  perform public.write_audit_log(
    v_team_id, 'Player Added', 'players', p_player_id,
    to_jsonb(concat_ws(', ',
      coalesce(v_spec_label, 'Unknown spec'),
      're-added',
      case when v_restored then 'membership restored' end))
  );

  return v_restored;
end $$;

comment on function public.restore_player(integer, text, text, integer, boolean, date) is
  'Officer-only: the Roster tab''s re-add (#1133). Brings an archived character back with the form''s values, a blank field keeping what the character had, and restores the membership it is linked to through restore_team_member() (Option 2 on #1355). Never touches player_officer_notes or removal_reasons, so why they left is kept (#1427). Writes the Player Added audit entry. Returns whether it restored the membership.';

revoke all on function public.restore_player(integer, text, text, integer, boolean, date) from public;
revoke execute on function public.restore_player(integer, text, text, integer, boolean, date) from anon;
grant execute on function public.restore_player(integer, text, text, integer, boolean, date) to authenticated;

comment on function public.restore_team_member(integer, integer) is
  'Officer-only: brings an archived team_members row back as a raider (#1402), whatever role it held, and writes a team_member_restored audit entry naming the role it held. Characters stay as they are: the caller brings back the one it adds. A membership that is not archived is left alone and nothing is logged. Returns whether it restored anyone, read under the row lock. Called by add_signup_to_roster() when the signer''s membership is archived, and by restore_player() for the membership a re-added character is linked to (#1133; Option 2 on #1355: any officer action brings an archived member back).';

comment on column public.team_members.archived_at is
  'Set when an officer archives this membership (archive_team_member, #1355) for someone who left -- never deleted, so the account''s history keeps pointing at something. Cleared when an officer brings them back: team_invite_link_join(), or restore_team_member() when an officer adds their season signup (#1402) or re-adds one of their characters on the Roster tab (restore_player(), #1133). Nothing changes it any other way: a direct update of the column is refused (team_members_archived_at_through_functions). Every "what is this person on this team" predicate (my_team_role, my_officer_team_ids, my_leader_team_ids, is_any_team_officer, is_team_leader_anywhere) skips an archived row, and so does every "what does this person own there" read (is_own_player, my_active_player_ids, and the own-character lookups in request_main_swap, set_own_rsvp and submit_self_received, #1401); my_player_ids() and earlier_characters() still read it, since that is the history.';
