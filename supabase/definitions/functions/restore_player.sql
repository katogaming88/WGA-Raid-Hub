-- Function public.restore_player: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.restore_player(p_player_id integer, p_name_realm text DEFAULT NULL::text, p_nickname text DEFAULT NULL::text, p_class_spec_id integer DEFAULT NULL::integer, p_is_trial boolean DEFAULT NULL::boolean, p_join_date date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$;
