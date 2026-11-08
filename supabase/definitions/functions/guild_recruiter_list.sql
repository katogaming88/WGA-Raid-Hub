-- Function public.guild_recruiter_list: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.guild_recruiter_list(p_guild_id integer)
 RETURNS TABLE(person_id integer, display_name text, code text, active boolean, in_guild boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not has_guild_permission(p_guild_id, 'manage_recruiters') then
    raise exception 'Not authorized';
  end if;

  return query
  select r.person_id, guild_person_name(p_guild_id, r.person_id), r.code, r.active,
         public.in_guild(p_guild_id, r.person_id)
    from guild_recruiters r
   where r.guild_id = p_guild_id
   order by 2, r.person_id;
end;
$function$;
