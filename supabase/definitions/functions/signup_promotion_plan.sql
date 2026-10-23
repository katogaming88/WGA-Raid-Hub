-- Function public.signup_promotion_plan: current definition, generated from the database.
-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).
-- execute (site roles): none

CREATE OR REPLACE FUNCTION public.signup_promotion_plan(p_team_id integer, p_season text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with sig as (
    select s.id, s.status, s.signup_name_realm,
           lower(replace(s.signup_name_realm, ' ', '')) as name_key,
           lower(replace(s.swap_from_name_realm, ' ', '')) as from_key,
           (select tm.id
              from team_members tm
              join people pe on pe.id = tm.person_id
             where tm.team_id = s.team_id
               and (pe.id = s.person_id or (s.person_id is null and pe.auth_user_id = s.auth_user_id))
             order by tm.id
             limit 1) as member_id
      from season_signups s
     where s.team_id = p_team_id and s.season = p_season and s.status <> 'rejected'
  ),
  active as (
    select p.id, p.name_realm, p.name_realm_key, p.team_member_id
      from players p
     where p.team_id = p_team_id and p.archived_at is null
  ),
  todo as (
    select sig.*,
           (select a.id from active a where a.name_realm_key = sig.name_key) as same_id,
           (select count(*) from active a where a.team_member_id = sig.member_id) as held,
           coalesce(
             (select min(a.id) from active a where a.team_member_id = sig.member_id having count(*) = 1),
             (select a.id from active a where a.name_realm_key = sig.from_key)
           ) as from_id
      from sig
     where sig.status in ('pending', 'approved')
  ),
  plan as (
    select case when same_id is not null then 'stays'
                when held > 1 then 'skipped'
                when from_id is not null then 'swaps'
                when member_id is not null then 'first_mains'
                else 'joins' end as kind,
           id, signup_name_realm, same_id, from_id
      from todo
  )
  select coalesce(jsonb_agg(r order by r.kind, r.name_realm, r.signup_id, r.player_id), '[]'::jsonb)
    from (
      select pl.kind,
             pl.id as signup_id,
             pl.same_id as player_id,
             pl.signup_name_realm as name_realm,
             case when pl.kind = 'swaps' then pl.from_id end as from_player_id,
             case when pl.kind = 'swaps' then (select a.name_realm from active a where a.id = pl.from_id) end as from_name_realm,
             case when pl.kind = 'skipped' then 'several_characters' end as reason
        from plan pl
      union all
      select 'archives', null, a.id, a.name_realm, null, null, null
        from active a
       where not exists (
               select 1 from sig
                where sig.name_key = a.name_realm_key
                   or sig.from_key = a.name_realm_key
                   or sig.member_id = a.team_member_id
             )
         and not exists (select 1 from plan where plan.kind = 'swaps' and plan.from_id = a.id)
    ) r;
$function$;
