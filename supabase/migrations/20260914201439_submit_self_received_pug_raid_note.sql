-- A Mark Received report from a pug raid is not held for saying "raid" (#868).
--
-- 20260908195554 sends any report whose note mentions "raid" as its own word
-- to officer review, to catch guild raid drops reported by hand. Kat added
-- Pug raid as a Mark Received source on 2026-09-14 (Soulcialist's boots were
-- an approved "Other" entry from one), and a raider choosing it will naturally
-- write "raid" in the note. The source already says it was not a guild raid,
-- so the note check skips it.
--
-- An Other report needs a note (Kat, 2026-09-14). Other goes to an officer,
-- and a report with no note gives them nothing to judge it by: it is the
-- catch-all for Timewalking, a Curio, a traded piece. Both sites' forms ask
-- for it; this refuses one sent without it. Every other rule is unchanged:
-- Other still goes to review, and only the raider's own character
-- auto-approves.
create or replace function public.submit_self_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null::text,
  p_source text default null::text,
  p_note text default null::text,
  p_slot text default null::text
)
returns table(id integer, auto_approved boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  if coalesce(p_source, '') = 'Other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say where the item came from in the note. An officer reviews Other reports.';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  if auth.uid() is not null
    and coalesce(p_source, '') <> 'Other'
    and (coalesce(p_source, '') = 'Pug raid' or coalesce(p_note, '') !~* '\yraid\y') then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.auth_user_id = auth.uid();
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  if coalesce(v_auto_approved, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (
      p_team_id,
      auth.uid(),
      'Self-Received Auto-Approved',
      'players',
      v_player_id,
      jsonb_build_object('item', p_item_name, 'track', p_track, 'source', p_source)
    );
  end if;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $$;
