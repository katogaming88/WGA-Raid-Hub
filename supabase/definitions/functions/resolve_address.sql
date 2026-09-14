-- Function public.resolve_address: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): anon, authenticated, public

CREATE OR REPLACE FUNCTION public.resolve_address(p_guild_key text, p_team_key text DEFAULT NULL::text, p_player_code text DEFAULT NULL::text)
 RETURNS TABLE(guild_id integer, guild_key text, team_id integer, team_key text, player_id integer, player_code text, is_canonical boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_guild_id integer;
  v_team_id integer;
  v_player_id integer;
begin
  if p_guild_key is null or (p_player_code is not null and p_team_key is null) then
    return;
  end if;

  select g.id into v_guild_id from public.guilds g where g.url_key = lower(p_guild_key);
  if v_guild_id is null then
    select r.guild_id into v_guild_id
      from public.retired_url_keys r
     where r.team_id is null and r.url_key = lower(p_guild_key)
     order by r.retired_at desc
     limit 1;
  end if;
  if v_guild_id is null then
    return;
  end if;

  if p_team_key is not null then
    select t.id into v_team_id
      from public.teams t
     where t.guild_id = v_guild_id and t.slug = lower(p_team_key);
    if v_team_id is null then
      select r.team_id into v_team_id
        from public.retired_url_keys r
       where r.guild_id = v_guild_id and r.team_id is not null and r.url_key = lower(p_team_key)
       order by r.retired_at desc
       limit 1;
    end if;
    if v_team_id is null then
      return;
    end if;
  end if;

  if p_player_code is not null then
    select p.id into v_player_id
      from public.players p
     where p.team_id = v_team_id and p.url_code = lower(p_player_code);
    if v_player_id is null then
      return;
    end if;
  end if;

  -- A team that moved guilds is reached through its old guild's retired key,
  -- so the canonical guild is the team's own, not the one the address named.
  return query
  select g.id,
         g.url_key,
         t.id,
         t.slug,
         p.id,
         p.url_code,
         g.url_key = p_guild_key
           and t.slug is not distinct from p_team_key
           and p.url_code is not distinct from p_player_code
    from public.guilds g
    left join public.teams t on t.id = v_team_id
    left join public.players p on p.id = v_player_id
   where g.id = coalesce(t.guild_id, v_guild_id);
end;
$function$;
