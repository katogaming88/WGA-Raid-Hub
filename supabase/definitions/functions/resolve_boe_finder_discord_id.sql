-- Function public.resolve_boe_finder_discord_id: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.resolve_boe_finder_discord_id(p_boe_id integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.boe_items%rowtype;
  v_discord_id text;
  v_first text;
  v_distinct integer;
begin
  -- The same pair boe_record_sale requires, so this admits exactly the people
  -- who could have caused the message it feeds.
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select * into v_row from public.boe_items where id = p_boe_id;
  if not found then
    return null;
  end if;

  -- 1. Stamped at submit, when the finder was signed in (#889). Trusted over
  -- everything below: it is the finder saying who they are.
  if v_row.finder_discord_id is not null then
    return v_row.finder_discord_id;
  end if;

  -- 2. The claimed character submit_boe_found resolved on the finding team.
  if v_row.player_id is not null then
    select pe.discord_id
    into v_discord_id
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    join public.people pe on pe.id = tm.person_id
    where p.id = v_row.player_id;

    if v_discord_id is not null then
      return v_discord_id;
    end if;
  end if;

  -- 3. The name, matched across every team.
  --
  -- Compare first name segments: a finder_name may be bare ("Brugamen") or
  -- carry a realm ("Glizzygary-Dalaran", "Warbird-Burning Blade"), so neither
  -- side compares whole.
  v_first := lower(btrim(split_part(coalesce(v_row.finder_name, ''), '-', 1)));
  if v_first = '' then
    return null;
  end if;

  -- Two rules that look like bugs and are not.
  --
  -- Removed characters count. The find that prompted this was reported a
  -- month after its character left the roster, so archived_at is not filtered
  -- here: the person is still in the guild's Discord and still owed their cut.
  --
  -- Ambiguity is judged on distinct discord_id, not on matching rows. A person
  -- with two character rows pointing at one member row is the common shape
  -- (a realm rename leaves one behind), and refusing that would help nobody.
  -- Two rows reaching two different people is the case worth refusing, and it
  -- falls back to the finder's name in bold rather than pinging a guess.
  select count(distinct pe.discord_id), min(pe.discord_id)
  into v_distinct, v_discord_id
  from public.players p
  join public.team_members tm on tm.id = p.team_member_id
  join public.people pe on pe.id = tm.person_id
  where lower(btrim(split_part(p.name_realm, '-', 1))) = v_first;

  if v_distinct = 1 then
    return v_discord_id;
  end if;

  return null;
end;
$function$;
