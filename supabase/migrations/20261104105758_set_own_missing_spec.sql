-- #1724: a raider sets the spec of their own roster character, once, while it
-- has none.
--
-- A character can reach the roster with no spec: Blizzard has none for it, or
-- it joined before the join read a below-max-level character's spec (Kat's
-- level 84 Death Knight on the Sandbox). Until now only an officer could set
-- one, and the Roster hid the character, so nobody could see it needed one.
--
-- Once a spec is set it is locked like any other (Kat, 2026-11-01): only an
-- officer changes it, except while signups are open, when the raider changes
-- it through their signup as before. So this refuses a character that already
-- has a spec, on the write itself.
--
-- When the raider's own saved Battle.net character names the class, the spec
-- has to be one of that class's, so a misclick can't make a Death Knight a
-- Priest. Without one, any spec is taken; an officer can fix a wrong pick.

create or replace function public.set_own_missing_spec(p_player_id integer, p_class_spec_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team_id integer;
  v_name_realm text;
  v_name_realm_key text;
  v_spec_class text;
  v_spec_label text;
  v_known_class text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not coalesce(public.is_own_player(p_player_id), false) then
    raise exception 'That is not your character.';
  end if;

  select cs.class, cs.spec || ' ' || cs.class into v_spec_class, v_spec_label
    from public.classes_specs cs
   where cs.id = p_class_spec_id;
  if v_spec_class is null then
    raise exception 'Unknown spec.';
  end if;

  -- Locked, and ownership checked again under the lock, so an officer's
  -- archive or reassignment that lands first is seen (CodeRabbit on #1759).
  select p.team_id, p.name_realm, p.name_realm_key into v_team_id, v_name_realm, v_name_realm_key
    from public.players p
   where p.id = p_player_id
     for update;
  if not coalesce(public.is_own_player(p_player_id), false) then
    raise exception 'That is not your character.';
  end if;

  -- The newest saved record, should a character have been remade as another
  -- class under the same name (fresh review on #1759).
  select c.class_name into v_known_class
    from public.characters c
   where c.person_id = public.my_person_id()
     and c.name_realm_key = v_name_realm_key
     and c.class_name is not null
   order by c.saved_at desc
   limit 1;
  if v_known_class is not null and v_known_class <> v_spec_class then
    raise exception 'That spec is not one of %''s. Pick a % spec.', v_known_class, v_known_class;
  end if;

  update public.players
     set class_spec_id = p_class_spec_id
   where id = p_player_id
     and class_spec_id is null;
  if not found then
    raise exception 'This character already has a spec. Ask an officer to change it.';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (v_team_id, v_uid, 'Spec Set by Raider', 'players', p_player_id,
          jsonb_build_object('name_realm', v_name_realm, 'spec', v_spec_label));
end;
$$;

comment on function public.set_own_missing_spec(integer, integer) is
  'A raider sets the spec of their own roster character while it has none (#1724). Refuses a character that already has a spec, and a spec of another class than their saved Battle.net character''s.';

revoke all on function public.set_own_missing_spec(integer, integer) from public, anon;
grant execute on function public.set_own_missing_spec(integer, integer) to authenticated;
