-- #151: in-app notification bell. A raider sees a badge/dropdown when one of
-- their own submissions (BiS link, self-received item, M+ exclusion request)
-- is approved or rejected -- no bot DM or manual check-back needed.
--
-- season_signups approve/reject is deliberately NOT wired to this: an
-- applicant has no players row (and so no team_member_id/auth_user_id link)
-- until status flips to 'added' at roster promotion, well after the
-- approve/reject step this feature targets. There's no player identity to
-- notify at that point.
--
-- Insert-only from officers via notify_player() (mirrors write_audit_log()'s
-- pattern, #214): no direct INSERT policy on the table at all, so a
-- notification can't be forged or misattributed by anything other than this
-- one audited path. Raiders can read and mark their own rows read via
-- is_own_player() (#286), same as streamers.

create table "public"."notifications" (
    "id" serial primary key,
    "team_id" integer not null references "public"."teams"("id") on delete cascade,
    "player_id" integer not null references "public"."players"("id") on delete cascade,
    "message" text not null,
    "read" boolean not null default false,
    "created_at" timestamp with time zone not null default now()
);

alter table "public"."notifications" owner to "postgres";

alter table "public"."notifications" enable row level security;

create trigger "trg_notifications_team_id_check"
    before insert or update on "public"."notifications"
    for each row execute function "public"."check_team_id_matches_player"();

create index "idx_notifications_player_unread" on "public"."notifications" ("player_id") where not "read";

create policy "Claude readers read notifications" on "public"."notifications" for select to "claude_readers" using (true);

create policy "Raiders read own notifications" on "public"."notifications"
    for select
    using ("public"."is_own_player"("player_id"));

-- Mark-as-read is the only raider write: with_check repeats the same
-- ownership predicate so a raider can't reassign a row to someone else's
-- player_id in the same update.
create policy "Raiders mark own notifications read" on "public"."notifications"
    for update
    using ("public"."is_own_player"("player_id"))
    with check ("public"."is_own_player"("player_id"));

create or replace function "public"."notify_player"(
    "p_player_id" integer,
    "p_message" text
) returns integer
    language plpgsql security definer
    set search_path = public
    as $$
declare
  v_team_id integer;
  v_id integer;
begin
  select team_id into v_team_id from players where id = p_player_id;
  if v_team_id is null then
    raise exception 'Unknown player_id %', p_player_id;
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  insert into public.notifications (team_id, player_id, message)
  values (v_team_id, p_player_id, p_message)
  returning id into v_id;

  return v_id;
end;
$$;

alter function "public"."notify_player"(integer, text) owner to "postgres";

revoke all on function "public"."notify_player"(integer, text) from public;
revoke execute on function "public"."notify_player"(integer, text) from anon;
grant execute on function "public"."notify_player"(integer, text) to authenticated;
