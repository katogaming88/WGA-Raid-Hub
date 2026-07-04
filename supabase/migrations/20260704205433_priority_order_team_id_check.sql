-- #271: priority_order carries a denormalized team_id alongside player_id but
-- was left off the check_team_id_matches_player() trigger set in #267. Add the
-- same guard the other five denormalized tables have. Table is empty, so no
-- backfill is needed.

create trigger "trg_priority_order_team_id_check"
    before insert or update on "public"."priority_order"
    for each row execute function "public"."check_team_id_matches_player"();
