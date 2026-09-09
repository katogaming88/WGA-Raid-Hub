-- #1025: the raid-note guard added in 20260828125630 rejected the whole
-- submission outright the moment the note mentioned "raid" as its own word,
-- regardless of source. That's broader than the problem it was written for
-- -- a raider legitimately reporting a Great Vault, Bonus Roll, or
-- pugged-heroic-raid item can describe it honestly ("pugged this in a
-- heroic raid last night") and get rejected outright, even though their
-- selected source already says this isn't a team raid drop needing the
-- officer's loot import.
--
-- Rather than reject, a "raid" mention now just forces the request to
-- 'pending' instead of letting it auto-approve -- an officer decides
-- whether it's really an undeclared team raid drop (in which case they can
-- reject it and let the loot import handle it once run) or a legitimate
-- report that happens to mention "raid" (Great Vault after a pug raid,
-- Bonus Roll, etc.). A hard rejection gave the raider no way to get a
-- genuine report through short of rewording their note; sending it to the
-- officer queue does not.
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

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  if auth.uid() is not null and coalesce(p_source, '') <> 'Other' and coalesce(p_note, '') !~* '\yraid\y' then
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
