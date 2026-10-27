-- Function public.guild_grants_keep_rank: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.guild_grants_keep_rank()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_moved boolean := tg_op <> 'UPDATE'
                     or (old.person_id, old.guild_id, old.grant_type)
                        is distinct from (new.person_id, new.guild_id, new.grant_type);
begin
  if not v_moved then
    return null;
  end if;
  if tg_op <> 'INSERT' and old.grant_type = 'guild_officer' then
    if exists (select 1 from guild_ranks
                where guild_id = old.guild_id and person_id = old.person_id and rank = 'owner') then
      raise exception 'That person is the guild''s Owner. Hand the guild to someone else first.';
    end if;
    update guild_ranks set rank = 'member'
     where guild_id = old.guild_id and person_id = old.person_id and rank = 'admin';
  end if;
  if tg_op <> 'DELETE' and new.grant_type = 'guild_officer' then
    insert into guild_ranks (guild_id, person_id, rank)
    values (new.guild_id, new.person_id, 'admin')
    on conflict (guild_id, person_id) do update set rank = 'admin'
     where guild_ranks.rank not in ('owner', 'admin');
  end if;
  return null;
end;
$function$;
