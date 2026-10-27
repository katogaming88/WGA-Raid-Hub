-- Function public.seed_rank_permissions: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.seed_rank_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_table_name = 'guilds' then
    insert into guild_rank_permissions (guild_id, rank, permission)
    select new.id, r.rank, p.permission
      from rank_permissions p, unnest(p.default_ranks) as r(rank)
     where p.scope = 'guild';
  else
    insert into team_rank_permissions (team_id, rank, permission)
    select new.id, r.rank, p.permission
      from rank_permissions p, unnest(p.default_ranks) as r(rank)
     where p.scope = 'team';
  end if;
  return null;
end;
$function$;
