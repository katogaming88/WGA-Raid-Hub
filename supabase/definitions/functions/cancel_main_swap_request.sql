-- Function public.cancel_main_swap_request: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): authenticated

CREATE OR REPLACE FUNCTION public.cancel_main_swap_request(p_request_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_person_id integer := public.my_person_id();
begin
  if v_person_id is null then
    raise exception 'Not signed in';
  end if;

  update public.main_swap_requests
     set status = 'cancelled', reviewed_at = now()
   where id = p_request_id
     and person_id = v_person_id
     and status = 'pending';

  if not found then
    raise exception 'No main swap of yours is waiting';
  end if;
end;
$function$;
