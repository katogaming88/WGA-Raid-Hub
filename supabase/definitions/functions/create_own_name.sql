-- Function public.create_own_name: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.create_own_name(p_team_id integer, p_label text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_label text := btrim(p_label);
  v_member_id integer;
  v_member_archived_at timestamp with time zone;
  v_name_id integer;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if v_label is null or v_label = '' then
    raise exception 'Type a name for your Member';
  end if;

  -- Typed by a raider and readable by anyone, so kept to a name's shape: one
  -- line, and short enough for a roster row (fresh-agent review).
  if length(v_label) > 40 then
    raise exception 'Keep your Member''s name to 40 characters or fewer';
  end if;
  if v_label ~ '[[:cntrl:]]' then
    raise exception 'Your Member''s name has to fit on one line';
  end if;

  -- for share, as in claim_name(): archive_team_member() locks this row
  -- first, so the check and the insert land wholly before or after an archive.
  select tm.id, tm.archived_at into v_member_id, v_member_archived_at
    from public.team_members tm
   where tm.team_id = p_team_id and tm.person_id = public.my_person_id()
     for share;

  if v_member_id is null then
    raise exception 'You are not on this team. Join it through its invite link first.';
  end if;

  if v_member_archived_at is not null then
    raise exception 'Your membership on this team has ended. Ask one of its officers to add you back.';
  end if;

  if exists (select 1 from public.names n where n.team_member_id = v_member_id) then
    raise exception 'You already have a Member on this team. Ask an officer if it needs changing.';
  end if;

  -- The unique indexes decide a race: the same person in two tabs, or two
  -- people typing the same label at once.
  begin
    insert into public.names (team_id, label, team_member_id)
    values (p_team_id, v_label, v_member_id)
    returning id into v_name_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'names_team_id_label_key' then
      raise exception 'This team already has a Member called %. If that is you, claim it instead.', v_label;
    end if;
    raise exception 'You already have a Member on this team. Ask an officer if it needs changing.';
  end;

  -- Its own row, since write_audit_log() refuses a raider, as claim_name()
  -- does. self marks it apart from an officer's Name Created.
  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, 'Name Created', 'names', v_name_id,
          jsonb_build_object('label', v_label, 'team_member_id', v_member_id, 'self', true));

  return v_name_id;
end;
$function$;
