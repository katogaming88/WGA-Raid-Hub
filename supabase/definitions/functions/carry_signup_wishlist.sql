-- Function public.carry_signup_wishlist: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.carry_signup_wishlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'added' and new.approved_player_id is not null then
    insert into item_preferences (team_id, player_id, item_id, status, note, slot, season, synced_bis)
    select new.team_id, new.approved_player_id, sp.item_id, sp.status, sp.note, sp.slot, new.season, sp.synced_bis
      from signup_item_preferences sp
     where sp.signup_id = new.id
       and exists (
             select 1 from players p
              where p.id = new.approved_player_id
                and p.team_id = new.team_id
                and p.archived_at is null
                and p.name_realm_key = lower(replace(new.signup_name_realm, ' ', ''))
                and (p.team_member_id is null or exists (
                      select 1 from team_members tm
                        join people pe on pe.id = tm.person_id
                       where tm.id = p.team_member_id
                         and (pe.id = new.person_id
                              or (new.person_id is null and pe.auth_user_id = new.auth_user_id))
                    ))
           )
       and not exists (
             select 1 from item_preferences ip
              where ip.player_id = new.approved_player_id and ip.season = new.season
           );
  elsif new.status <> 'rejected'
        and lower(replace(new.signup_name_realm, ' ', '')) = lower(replace(old.signup_name_realm, ' ', '')) then
    return new;
  end if;

  delete from signup_item_preferences where signup_id = new.id;
  return new;
end $function$;
