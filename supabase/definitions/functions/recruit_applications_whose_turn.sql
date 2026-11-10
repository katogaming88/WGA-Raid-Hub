-- Function public.recruit_applications_whose_turn: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.recruit_applications_whose_turn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('waiting_on_officers', 'waiting_on_applicant') then
    new.status := case when new.officers_last_message_at > coalesce(new.applicant_last_message_at, '-infinity')
                       then 'waiting_on_applicant' else 'waiting_on_officers' end;
  end if;
  return new;
end;
$function$;
