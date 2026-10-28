-- Function public.set_guild_officer_bios: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.set_guild_officer_bios(p_bios jsonb, p_guild_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_guild integer;
  v_me text := public.my_person_id()::text;
  v_old jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if jsonb_typeof(p_bios) is distinct from 'array' then
    raise exception 'The bio cards must be a list';
  end if;

  v_guild := coalesce(p_guild_id, public.only_guild_id());
  -- Locked, so two own-card saves cannot each pass the check below against
  -- the list the other is replacing.
  select officer_bios into v_old from guilds where id = v_guild for update;
  if not found then
    raise exception 'There is no such guild';
  end if;

  if not (public.is_site_admin() or public.has_guild_permission(v_guild, 'edit_all_bios')) then
    -- Their own cards only: the cards that are not theirs, a card with no
    -- personId among them, come back unchanged and in the same order.
    if v_me is null
       or not public.has_guild_permission(v_guild, 'edit_own_bio')
       or (select coalesce(jsonb_agg(c order by i), '[]'::jsonb)
             from jsonb_array_elements(v_old) with ordinality as e(c, i)
            where c ->> 'personId' is distinct from v_me)
          is distinct from
          (select coalesce(jsonb_agg(c order by i), '[]'::jsonb)
             from jsonb_array_elements(p_bios) with ordinality as e(c, i)
            where c ->> 'personId' is distinct from v_me) then
      raise exception 'Not authorized';
    end if;
  end if;

  update guilds set officer_bios = p_bios where id = v_guild;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (null, v_uid, 'Guild Officer Bios Saved', 'guilds', v_guild,
          jsonb_build_object('count', jsonb_array_length(p_bios)));

  return p_bios;
end;
$function$;
