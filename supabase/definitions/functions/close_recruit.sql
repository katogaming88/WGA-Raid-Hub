-- Function public.close_recruit: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.close_recruit(p_application_id integer, p_status text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if recruit_access((select team_id from recruit_applications where id = p_application_id)) is distinct from 'manage' then
    raise exception 'Not authorized';
  end if;
  perform recruit_close(p_application_id, my_person_id(), p_status, p_reason);
end;
$function$;
