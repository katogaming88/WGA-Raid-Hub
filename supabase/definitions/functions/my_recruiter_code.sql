-- Function public.my_recruiter_code: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.my_recruiter_code(p_guild_id integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return (select r.code
            from guild_recruiters r
           where r.guild_id = p_guild_id and r.person_id = my_person_id()
             and r.active and in_guild(r.guild_id, r.person_id));
end;
$function$;
