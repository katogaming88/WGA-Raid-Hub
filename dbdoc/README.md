# postgres

## Tables

| Name | Columns | Comment | Type |
| ---- | ------- | ------- | ---- |
| [public.attendance](public.attendance.md) | 9 |  | BASE TABLE |
| [public.audit_log](public.audit_log.md) | 8 |  | BASE TABLE |
| [public.bis_requests](public.bis_requests.md) | 8 |  | BASE TABLE |
| [public.classes_specs](public.classes_specs.md) | 4 |  | BASE TABLE |
| [public.item_bosses](public.item_bosses.md) | 2 |  | BASE TABLE |
| [public.items](public.items.md) | 15 |  | BASE TABLE |
| [public.rclc_loot](public.rclc_loot.md) | 11 |  | BASE TABLE |
| [public.mplus_exclusion_requests](public.mplus_exclusion_requests.md) | 9 |  | BASE TABLE |
| [public.player_wcl_season_perf](public.player_wcl_season_perf.md) | 7 |  | BASE TABLE |
| [public.players](public.players.md) | 25 |  | BASE TABLE |
| [public.priority_order](public.priority_order.md) | 8 |  | BASE TABLE |
| [public.scoring](public.scoring.md) | 11 |  | BASE TABLE |
| [public.season_signups](public.season_signups.md) | 18 |  | BASE TABLE |
| [public.self_received_requests](public.self_received_requests.md) | 12 |  | BASE TABLE |
| [public.team_members](public.team_members.md) | 8 |  | BASE TABLE |
| [public.team_settings](public.team_settings.md) | 3 |  | BASE TABLE |
| [public.teams](public.teams.md) | 6 |  | BASE TABLE |
| [public.pending_roster](public.pending_roster.md) | 15 |  | VIEW |
| [public.rnlsi](public.rnlsi.md) | 6 |  | VIEW |
| [public.bis_demand_vs_awards](public.bis_demand_vs_awards.md) | 7 |  | VIEW |
| [public.priority_order_stale_entries](public.priority_order_stale_entries.md) | 10 |  | VIEW |
| [public.priority_order_gaps](public.priority_order_gaps.md) | 4 |  | VIEW |
| [public.season_loot_pace](public.season_loot_pace.md) | 6 |  | VIEW |
| [public.streamers](public.streamers.md) | 10 |  | BASE TABLE |
| [public.notifications](public.notifications.md) | 6 |  | BASE TABLE |
| [public.raid_zones](public.raid_zones.md) | 6 |  | BASE TABLE |
| [public.raid_encounters](public.raid_encounters.md) | 6 |  | BASE TABLE |
| [public.team_raid_progress](public.team_raid_progress.md) | 14 |  | BASE TABLE |
| [public.priority_order_live_first_prios](public.priority_order_live_first_prios.md) | 9 |  | VIEW |
| [public.priority_order_first_prio_counts](public.priority_order_first_prio_counts.md) | 5 |  | VIEW |
| [public.priority_order_same_boss_conflicts](public.priority_order_same_boss_conflicts.md) | 10 |  | VIEW |
| [public.priority_order_stale_after_heroic](public.priority_order_stale_after_heroic.md) | 7 |  | VIEW |
| [public.item_preferences](public.item_preferences.md) | 11 |  | BASE TABLE |
| [public.site_settings](public.site_settings.md) | 10 |  | BASE TABLE |
| [public.incoming_roster](public.incoming_roster.md) | 7 |  | VIEW |
| [public.tier_token_map](public.tier_token_map.md) | 6 |  | BASE TABLE |
| [public.boe_items](public.boe_items.md) | 26 |  | BASE TABLE |
| [public.boe_listings](public.boe_listings.md) | 8 |  | BASE TABLE |
| [public.priority_conflict_dismissals](public.priority_conflict_dismissals.md) | 8 | Officer-acknowledged Priority List same-boss conflicts (a player holding #1 on 2+ items behind one boss+track kill), so buildPriorityConflictsBannerHtml() (js/tabs/tab-priority.js) stops re-flagging a reviewed one. | BASE TABLE |
| [public.player_equipped_gear](public.player_equipped_gear.md) | 9 | One row per player per physical gear slot (Blizzard API slot keys: HEAD, FINGER_1, FINGER_2, ...), synced from the Blizzard Character Equipment Summary endpoint. Feeds generate_priority_order()'s equipped-item-level fairness factor. | BASE TABLE |
| [public.priority_order_confirmed_empty](public.priority_order_confirmed_empty.md) | 5 | Marks a team/season/item/track priority list as deliberately saved empty (no one wants the item) -- keeps it out of the Unmanaged Items list without a placeholder priority_order row. Cleared automatically the next time that item/track is saved with a non-empty roster. | BASE TABLE |
| [public.priority_stale_dismissals](public.priority_stale_dismissals.md) | 7 | Officer-acknowledged "stale-after-Heroic" Priority List conflicts (a Mythic #1 who already has the Heroic version of the same item), so buildPriorityConflictsBannerHtml() (js/tabs/tab-priority.js) stops re-flagging a reviewed one. Sibling to priority_conflict_dismissals, kept separate since this is keyed by player+item rather than player+boss+track. | BASE TABLE |
| [public.raid_schedule](public.raid_schedule.md) | 9 | The raid calendar's officer-owned recurring weekly rule (#892, part of #640): one row per weekday/time this team normally raids. is_optional flags a night with no automatic default-Present (#895) -- every non-bench roster player must explicitly RSVP. Raid nights are computed on the fly from this table plus raid_schedule_exceptions (js/calendar.js, computeRaidNights()), not materialized as rows. | BASE TABLE |
| [public.raid_schedule_exceptions](public.raid_schedule_exceptions.md) | 10 | One-off cancellation or addition on top of raid_schedule's recurring rule (#892) -- exception_type distinguishes skipping a normally-scheduled night from adding an extra one. is_optional only applies to an 'added' row. | BASE TABLE |
| [public.raid_rsvps](public.raid_rsvps.md) | 8 | A raider's self-declared override for one raid night (#893, part of #640) -- absence of a row means the computed default (Present, or Bench/Rotator via players.is_bench/is_rotator) applies. Forward-looking intent only, never synced into public.attendance. Written only through set_own_rsvp() or officer_set_rsvp() (SECURITY DEFINER); the Rotator-In status is written only through officer_set_rotator_week(). No direct INSERT/UPDATE/DELETE grant for anyone. | BASE TABLE |
| [public.raid_rsvp_reminders_sent](public.raid_rsvp_reminders_sent.md) | 6 | Dedup log for the optional-night DM reminder sweep (#895, part of #640) -- records that a 24h/2h reminder was already sent for a player/raid_date/checkpoint so the cron sweep does not re-DM on every tick. Insert-only, written solely by the optional-rsvp-reminders Edge Function via the service role. Not the source of truth for whether a player has responded -- that is raid_rsvps. | BASE TABLE |
| [public.raid_signup_sheets](public.raid_signup_sheets.md) | 6 | Bookkeeping for the bot-owned aggregated signup-sheet Discord message (#900, part of #640): tracks which channel/message holds the one edited-in-place embed per team/raid_date. Written and read only by the bot's service-role client via claim_raid_signup_sheet(); no read use case for an officer or end user. Mirrors raid_rsvp_reminders_sent's locked-down shape (#895). | BASE TABLE |
| [public.player_officer_notes](public.player_officer_notes.md) | 6 | Officer-only annotations on a roster slot (#925): the private officer note, and why a player was removed plus the freeform specifics (#476). One row per players row, created on first write. These lived on players until #925, where the table's public read policy and its table-level anon grant made them readable with the publishable key and by every signed-in raider. m_plus_note stayed on players because the public profile renders it. archived_reason keeps the fixed vocabulary its old CHECK constraint carried. | BASE TABLE |
| [public.team_discord_config](public.team_discord_config.md) | 12 | Per-team Discord infra config for the consolidated multi-tenant bot (#991): guild/channel/role ids and script URLs the bot needs to route a relayed action to the right place. Written and read only by the bot's service-role client; no read use case for an officer or end user. Mirrors raid_signup_sheets' locked-down shape (#900). | BASE TABLE |
| [public.track_bonus_ids](public.track_bonus_ids.md) | 5 | Maps a WoW item bonus ID to its gear upgrade track and rank (e.g. 12853 -> Myth 5/6). Read by blizzard-gear-sync when syncing equipped gear, and the intended future home of the constants currently inlined in import_rclc_loot(). Seeded by hand per tier -- append the new block, never edit or delete old rows, since older gear keeps its original bonus IDs. | BASE TABLE |
| [public.account_preferences](public.account_preferences.md) | 6 | Per-account preferences, one row per (account, team, key); team_id is null for guild-wide keys. The account_preferences_known_key CHECK lists every allowed key. Replaced no_character_dismissals (#940). | BASE TABLE |
| [public.guilds](public.guilds.md) | 6 | One row per guild. url_key is the /g/<key> segment of an address: readable for WGA, a random code for any other guild (#1100, #1114). | BASE TABLE |
| [public.retired_url_keys](public.retired_url_keys.md) | 5 | Keys a guild (team_id null) or team used to have, so old addresses still resolve. Written only by the key-change triggers on guilds and teams (#1114). guild_id is the guild the key lived under. | BASE TABLE |
| [public.people](public.people.md) | 4 | One row per human (#942). auth_user_id is their sign-in account, null for a Discord id listed on a grant before its owner signed in. discord_id is null for an account with no Discord linked. Grant tables point here through person_id. | BASE TABLE |
| [public.seasons](public.seasons.md) | 5 | One row per raid tier (#932). code is the short form every season column references (MID2); display_name is what officers see and type (Midnight Season 2), and nothing keys to it since #936. A tier is added by a migration that closes the outgoing row and inserts the new one. | BASE TABLE |
| [public.guild_grants](public.guild_grants.md) | 5 | Guild-wide grants, one row per person per grant per guild (#942). Replaced site_admins, guild_officers and boe_managers, which remain as read-only views until cutover. | BASE TABLE |
| [public.site_admins](public.site_admins.md) | 5 | Read-only view of guild_grants (#942), dropped at cutover (#1105). | VIEW |
| [public.guild_officers](public.guild_officers.md) | 5 | Read-only view of guild_grants (#942), dropped at cutover (#1105). | VIEW |
| [public.boe_managers](public.boe_managers.md) | 5 | Read-only view of guild_grants (#942), dropped at cutover (#1105). | VIEW |
| [public.characters](public.characters.md) | 13 | Characters a person chose to show from their Battle.net account (#942 step 5, #1162). Written only by save_battlenet_characters() from the battlenet-characters Edge Function. A character here is an alt unless the same name_realm_key is a roster row linked to the person. | BASE TABLE |
| [public.main_swap_requests](public.main_swap_requests.md) | 14 | A raider's request to make one of their alts their roster character, outside a signup window (#631, #942 step 5c). Written only by request_main_swap(), cancel_main_swap_request() and review_main_swap_request(). name_realm and class_spec_id are what they asked for, kept here so the request still reads right after the character row changes. | BASE TABLE |
| [public.boss_groups](public.boss_groups.md) | 5 | The standing group per boss for a team (#1216): one row per raider in the group that kills that boss. A new raid night is filled from these. Written only through set_boss_group(). | BASE TABLE |
| [public.raid_night_bosses](public.raid_night_bosses.md) | 9 | The bosses on one raid night's list for a team (#1216), in pull order. skipped keeps a boss the team is not pulling that night on the list. confirmed_at and confirmed_by say an officer saved that boss's lineup for the night; until then it follows the boss's standing group. No rows for a night means it is not planned yet. | BASE TABLE |
| [public.raid_night_lineups](public.raid_night_lineups.md) | 6 | The plan for one raid night (#1216): one row per raider in for one boss. Filled from boss_groups ahead of the night, then edited through set_raid_night_lineup(). Kept after the night, so it still says who was planned in. | BASE TABLE |
| [public.team_lineup_settings](public.team_lineup_settings.md) | 4 | A team's own tanks-wanted and healers-wanted counts for the boss lineup's "Needs a look" check (#1244), defaulting to 2 and 4 when a team has no row. Written only by set_lineup_role_targets(). | BASE TABLE |
| [public.team_seasons](public.team_seasons.md) | 6 | A team's two switches per tier (#939): whether raiders can sign up and whether they can edit their wishlist. No row means both closed. Written only by set_team_season(). | BASE TABLE |
| [public.team_invite_links](public.team_invite_links.md) | 5 | One active invite code per team (#1264). Resetting overwrites the row, so the old code stops resolving immediately. | BASE TABLE |
| [public.item_seasons](public.item_seasons.md) | 2 | The seasons a dungeon or crafted item is offered in (#1166). A raid item has no row: its season comes from raid_zones. Filled by scripts/dungeon-items-sql.js, never by a client. | BASE TABLE |

## Stored procedures and functions

| Name | ReturnType | Arguments | Type |
| ---- | ------- | ------- | ---- |
| public.check_team_id_matches_player | trigger |  | FUNCTION |
| public.is_site_admin | bool |  | FUNCTION |
| public.link_auth_user_to_member | trigger |  | FUNCTION |
| public.my_team_role | text | p_team_id integer | FUNCTION |
| public.rls_auto_enable | event_trigger |  | FUNCTION |
| public.set_updated_at | trigger |  | FUNCTION |
| public.claim_character | record | p_team_id integer, p_name_realm text | FUNCTION |
| public.write_audit_log | int4 | p_team_id integer, p_action text, p_target_type text DEFAULT NULL::text, p_target_id integer DEFAULT NULL::integer, p_detail jsonb DEFAULT NULL::jsonb | FUNCTION |
| public.resolve_actor_name | text | p_actor_id uuid, p_team_id integer | FUNCTION |
| public.import_rclc_loot | jsonb | p_team_id integer, p_season text, p_rows jsonb | FUNCTION |
| public.resolve_discord_display_name | text | p_actor_id uuid, p_team_id integer | FUNCTION |
| public.save_priority_order | int4 | p_team_id integer, p_season text, p_item_id integer, p_track text, p_player_ids jsonb | FUNCTION |
| public.danger_clear_bis_requests | int4 | p_team_id integer | FUNCTION |
| public.danger_clear_season_signups | int4 | p_team_id integer | FUNCTION |
| public.danger_clear_pending_roster | int4 | p_team_id integer | FUNCTION |
| public.danger_clear_mplus_exclusion_requests | int4 | p_team_id integer | FUNCTION |
| public.danger_clear_self_received_requests | int4 | p_team_id integer | FUNCTION |
| public.is_own_player | bool | p_player_id integer | FUNCTION |
| public.notify_player | int4 | p_player_id integer, p_message text | FUNCTION |
| public.submit_bis_link | int4 | p_team_id integer, p_name_realm text, p_bis_link text, p_player_note text DEFAULT NULL::text | FUNCTION |
| public.submit_mplus_exclusion | int4 | p_team_id integer, p_name_realm text, p_raiderio_url text DEFAULT NULL::text, p_reason text DEFAULT NULL::text | FUNCTION |
| public.admin_create_team | int4 | p_name text, p_slug text | FUNCTION |
| public.admin_update_team | void | p_team_id integer, p_name text, p_slug text | FUNCTION |
| public.admin_set_team_archived | void | p_team_id integer, p_archived boolean | FUNCTION |
| public.admin_list_site_admins | record |  | FUNCTION |
| public.admin_grant_site_admin | int4 | p_discord_id text | FUNCTION |
| public.admin_revoke_site_admin | void | p_discord_id text | FUNCTION |
| public.admin_set_maintenance_mode | void | p_enabled boolean, p_message text DEFAULT NULL::text | FUNCTION |
| public.submit_self_received | record | p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_slot text DEFAULT NULL::text | FUNCTION |
| public.direct_mark_received | int4 | p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_slot text DEFAULT NULL::text | FUNCTION |
| public.set_guild_officer_bios | jsonb | p_bios jsonb | FUNCTION |
| public.flag_bis_list_changed | int4 | p_team_id integer, p_name_realm text, p_player_note text DEFAULT NULL::text | FUNCTION |
| public.update_own_signup | int4 | p_signup_id integer, p_name_realm text, p_class text, p_spec text, p_off_specs text DEFAULT ''::text, p_main_swap boolean DEFAULT false, p_player_note text DEFAULT NULL::text, p_swap_from_name_realm text DEFAULT NULL::text | FUNCTION |
| public.add_signup_to_roster | int4 | p_signup_id integer, p_is_trial boolean DEFAULT true, p_archive_player_id integer DEFAULT NULL::integer, p_is_backup_tank boolean DEFAULT false, p_is_backup_healer boolean DEFAULT false | FUNCTION |
| public.set_team_setting | jsonb | p_team_id integer, p_updates jsonb, p_skip_audit boolean DEFAULT false | FUNCTION |
| public.is_guild_officer | bool |  | FUNCTION |
| public.admin_list_guild_officers | record |  | FUNCTION |
| public.admin_grant_guild_officer | int4 | p_discord_id text | FUNCTION |
| public.admin_revoke_guild_officer | void | p_discord_id text | FUNCTION |
| public.check_priority_order_drift | record | p_team_id integer, p_season text | FUNCTION |
| public.restrict_players_self_update_to_bonus_roll | trigger |  | FUNCTION |
| public.restrict_item_preferences_officer_update_to_note_clear | trigger |  | FUNCTION |
| public.generate_priority_order | record | p_team_id integer, p_season text, p_item_id integer, p_track text | FUNCTION |
| public.wishlist_setup_status | record | p_team_id integer | FUNCTION |
| public.check_team_id_matches_boe_item | trigger |  | FUNCTION |
| public.check_boe_status_transition | trigger |  | FUNCTION |
| public.boe_record_listing | void | p_id integer, p_price bigint, p_listed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT NULL::text | FUNCTION |
| public.boe_retire | void | p_id integer, p_note text DEFAULT NULL::text | FUNCTION |
| public.boe_revert | text | p_id integer | FUNCTION |
| public.set_boe_payout_settings | void | p_floor bigint, p_pivot bigint | FUNCTION |
| public.delete_self_received_request | void | p_id integer | FUNCTION |
| public.is_boe_manager | bool |  | FUNCTION |
| public.is_any_team_officer | bool |  | FUNCTION |
| public.admin_list_boe_managers | record |  | FUNCTION |
| public.admin_grant_boe_manager | int4 | p_discord_id text | FUNCTION |
| public.admin_revoke_boe_manager | void | p_discord_id text | FUNCTION |
| public.is_team_leader_anywhere | bool |  | FUNCTION |
| public.remove_player_priority_order | int4 | p_team_id integer, p_season text, p_player_id integer | FUNCTION |
| public.set_team_officer_bios | jsonb | p_team_id integer, p_bios jsonb | FUNCTION |
| public.build_rclc_export | jsonb | p_team_id integer, p_season text, p_track text | FUNCTION |
| public.boe_mark_paid | void | p_id integer, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_donated boolean DEFAULT false | FUNCTION |
| public.submit_boe_found | int4 | p_team_id integer, p_name_realm text, p_item_name text, p_track text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_donate boolean DEFAULT false, p_upgrade_rank text DEFAULT NULL::text | FUNCTION |
| public.set_own_rsvp | void | p_team_id integer, p_raid_date date, p_status text, p_note text DEFAULT NULL::text | FUNCTION |
| public.boe_record_sale | record | p_id integer, p_sale_price bigint, p_sold_at timestamp with time zone DEFAULT NULL::timestamp with time zone | FUNCTION |
| public.can_settle_boe | bool | p_team_id integer | FUNCTION |
| public.current_discord_id | text |  | FUNCTION |
| public.admin_grant_team_role | uuid | p_team_id integer, p_discord_id text, p_role text | FUNCTION |
| public.admin_revoke_team_role | void | p_team_id integer, p_discord_id text | FUNCTION |
| public.is_optional_raid_night | bool | p_team_id integer, p_raid_date date | FUNCTION |
| public.claim_raid_signup_sheet | text | p_team_id integer, p_raid_date date, p_channel_id text | FUNCTION |
| public.raid_night_info | record | p_team_id integer, p_raid_date date | FUNCTION |
| public.resolve_boe_finder_discord_id | text | p_boe_id integer | FUNCTION |
| public.archive_player | timestamptz | p_player_id integer, p_reason text, p_detail text | FUNCTION |
| public.officer_set_rsvp | void | p_team_id integer, p_player_id integer, p_raid_date date, p_status text, p_note text | FUNCTION |
| public.officer_set_rotator_week | void | p_team_id integer, p_player_id integer, p_week_start date, p_in boolean | FUNCTION |
| public.app_version | jsonb |  | FUNCTION |
| public.touch_account_preference_set_at | trigger |  | FUNCTION |
| public.clear_no_character_dismissal_on_link | trigger |  | FUNCTION |
| public.new_url_code | text |  | FUNCTION |
| public.keep_player_url_code | trigger |  | FUNCTION |
| public.retire_guild_url_key | trigger |  | FUNCTION |
| public.retire_team_url_key | trigger |  | FUNCTION |
| public.resolve_address | record | p_guild_key text, p_team_key text DEFAULT NULL::text, p_player_code text DEFAULT NULL::text | FUNCTION |
| public.resolve_person | jsonb | p_discord_id text | FUNCTION |
| public.my_officer_team_ids | _int4 |  | FUNCTION |
| public.my_leader_team_ids | _int4 |  | FUNCTION |
| public.my_active_player_ids | _int4 |  | FUNCTION |
| public.auth_user_for_discord_id | uuid | p_discord_id text | FUNCTION |
| public.team_battlenet_connections | int4 | p_team_id integer | FUNCTION |
| public.person_for_discord_id | int4 | p_discord_id text | FUNCTION |
| public.set_person_from_discord_id | trigger |  | FUNCTION |
| public.delete_empty_person | trigger |  | FUNCTION |
| public.only_guild_id | int4 |  | FUNCTION |
| public.admin_list_grants | record | p_grant_type text | FUNCTION |
| public.admin_grant | int4 | p_grant_type text, p_discord_id text, p_label text | FUNCTION |
| public.admin_revoke | void | p_grant_type text, p_discord_id text, p_label text | FUNCTION |
| public.my_person_id | int4 |  | FUNCTION |
| public.copy_person_account_to_members | trigger |  | FUNCTION |
| public.my_player_ids | _int4 |  | FUNCTION |
| public.battlenet_account_id | text | p_auth_user_id uuid | FUNCTION |
| public.link_battlenet_roster_characters | record | p_person_id integer, p_characters jsonb | FUNCTION |
| public.save_battlenet_characters | characters | p_person_id integer, p_characters jsonb | FUNCTION |
| public.earlier_characters | record | p_team_id integer | FUNCTION |
| public.request_main_swap | int4 | p_team_id integer, p_character_id integer, p_class_spec_id integer, p_note text DEFAULT NULL::text | FUNCTION |
| public.cancel_main_swap_request | void | p_request_id integer | FUNCTION |
| public.review_main_swap_request | int4 | p_request_id integer, p_approve boolean, p_note text DEFAULT NULL::text | FUNCTION |
| public.team_rsvp_answers | record | p_team_id integer, p_from date, p_to date | FUNCTION |
| public.check_lineup_players | void | p_team_id integer, p_player_ids integer[] | FUNCTION |
| public.same_player_set | bool | a integer[], b integer[] | FUNCTION |
| public.raid_today | date |  | FUNCTION |
| public.fill_raid_night | int4 | p_team_id integer, p_raid_date date | FUNCTION |
| public.fill_upcoming_raid_nights | int4 |  | FUNCTION |
| public.set_boss_group | int4 | p_team_id integer, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] DEFAULT NULL::integer[] | FUNCTION |
| public.plan_raid_night | int4 | p_team_id integer, p_raid_date date | FUNCTION |
| public.set_raid_night_lineup | int4 | p_team_id integer, p_raid_date date, p_encounter_id integer, p_player_ids integer[], p_expected_player_ids integer[] DEFAULT NULL::integer[] | FUNCTION |
| public.set_raid_night_boss_skipped | void | p_team_id integer, p_raid_date date, p_encounter_id integer, p_skipped boolean | FUNCTION |
| public.set_encounter_cap | void | p_encounter_id integer, p_cap integer DEFAULT NULL::integer | FUNCTION |
| public.set_lineup_role_targets | void | p_team_id integer, p_tanks integer, p_healers integer | FUNCTION |
| public.current_season | text | p_on date DEFAULT ((now() AT TIME ZONE 'America/New_York'::text))::date | FUNCTION |
| public.set_team_season | team_seasons | p_team_id integer, p_season_code text, p_signups_open boolean DEFAULT NULL::boolean, p_wishlist_open boolean DEFAULT NULL::boolean | FUNCTION |
| public.submit_season_signup | int4 | p_team_id integer, p_name_realm text, p_class text, p_spec text, p_off_specs text DEFAULT ''::text, p_main_swap boolean DEFAULT false, p_player_note text DEFAULT NULL::text, p_swap_from_name_realm text DEFAULT NULL::text, p_season text DEFAULT NULL::text | FUNCTION |
| public.get_own_signup | record | p_team_id integer, p_season text DEFAULT NULL::text | FUNCTION |
| public.close_season | jsonb | p_team_id integer, p_season text, p_roster_snapshot jsonb | FUNCTION |
| public.team_season_start | date | p_team_id integer, p_season text DEFAULT current_season() | FUNCTION |
| public.format_boe_gold | text | n bigint | FUNCTION |
| public.boe_edit_item | void | p_id integer, p_item_name text, p_track text, p_note text, p_item_id integer, p_upgrade_rank text | FUNCTION |
| public.team_invite_link_reset | team_invite_links | p_team_id integer, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone | FUNCTION |
| public.team_invite_link_resolve | record | p_code text | FUNCTION |
| public.team_invite_link_revoke | void | p_team_id integer | FUNCTION |
| public.team_invite_link_join | text | p_code text, p_blizzard_id bigint | FUNCTION |
| public.guild_creation_open | bool |  | FUNCTION |
| public.admin_set_guild_creation_open | void | p_open boolean | FUNCTION |
| public.create_guild | record | p_name text, p_region text, p_realm text, p_team_name text DEFAULT NULL::text | FUNCTION |

## Enums

| Name | Values |
| ---- | ------- |
| auth.aal_level | aal1, aal2, aal3 |
| auth.code_challenge_method | plain, s256 |
| auth.factor_status | unverified, verified |
| auth.factor_type | phone, totp, webauthn |
| auth.oauth_authorization_status | approved, denied, expired, pending |
| auth.oauth_client_type | confidential, public |
| auth.oauth_registration_type | dynamic, manual |
| auth.oauth_response_type | code |
| auth.one_time_token_type | confirmation_token, email_change_token_current, email_change_token_new, phone_change_token, reauthentication_token, recovery_token |
| net.request_status | ERROR, PENDING, SUCCESS |
| realtime.action | DELETE, ERROR, INSERT, TRUNCATE, UPDATE |
| realtime.equality_op | eq, gt, gte, ilike, imatch, in, is, isdistinct, like, lt, lte, match, neq |
| storage.buckettype | ANALYTICS, STANDARD, VECTOR |

## Relations

```mermaid
erDiagram

"public.attendance" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.attendance" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.audit_log" }o--o| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.bis_requests" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.bis_requests" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.item_bosses" }o--|| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.rclc_loot" }o--o| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL"
"public.rclc_loot" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.rclc_loot" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.rclc_loot" }o--o| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.mplus_exclusion_requests" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.mplus_exclusion_requests" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.player_wcl_season_perf" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.player_wcl_season_perf" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.player_wcl_season_perf" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.players" }o--o| "public.classes_specs" : "FOREIGN KEY (class_spec_id) REFERENCES classes_specs(id) ON UPDATE CASCADE"
"public.players" }o--o| "public.team_members" : "FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE SET NULL"
"public.players" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.players" }o--o| "public.raid_encounters" : "FOREIGN KEY (bonus_roll_encounter_id) REFERENCES raid_encounters(id) ON DELETE SET NULL"
"public.priority_order" }o--|| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id)"
"public.priority_order" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.priority_order" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.priority_order" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.scoring" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.scoring" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.scoring" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.season_signups" }o--o| "public.classes_specs" : "FOREIGN KEY (swap_class_spec_id) REFERENCES classes_specs(id) ON UPDATE CASCADE"
"public.season_signups" }o--o| "public.classes_specs" : "FOREIGN KEY (class_spec_id) REFERENCES classes_specs(id) ON UPDATE CASCADE"
"public.season_signups" }o--o| "public.players" : "FOREIGN KEY (approved_player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.season_signups" }o--o| "public.team_members" : "FOREIGN KEY (reviewed_by) REFERENCES team_members(id) ON DELETE SET NULL"
"public.season_signups" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.season_signups" }o--o| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.self_received_requests" }o--|| "public.items" : "FOREIGN KEY (self_item_id) REFERENCES items(id) ON DELETE SET NULL"
"public.self_received_requests" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.self_received_requests" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.team_members" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.team_members" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id)"
"public.team_settings" |o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.teams" }o--|| "public.guilds" : "FOREIGN KEY (guild_id) REFERENCES guilds(id)"
"public.streamers" |o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.streamers" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.notifications" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.notifications" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.raid_zones" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.raid_encounters" }o--|| "public.raid_zones" : "FOREIGN KEY (zone_id) REFERENCES raid_zones(id) ON DELETE CASCADE"
"public.team_raid_progress" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.team_raid_progress" }o--|| "public.raid_encounters" : "FOREIGN KEY (encounter_id) REFERENCES raid_encounters(id) ON DELETE CASCADE"
"public.item_preferences" }o--|| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.item_preferences" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.item_preferences" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.item_preferences" }o--o| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.tier_token_map" }o--|| "public.items" : "FOREIGN KEY (resolved_item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.tier_token_map" }o--|| "public.items" : "FOREIGN KEY (token_item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.tier_token_map" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.boe_items" }o--o| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL"
"public.boe_items" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.boe_items" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.boe_items" }o--o| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.boe_listings" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.boe_listings" }o--|| "public.boe_items" : "FOREIGN KEY (boe_item_id) REFERENCES boe_items(id) ON DELETE CASCADE"
"public.priority_conflict_dismissals" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.priority_conflict_dismissals" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.priority_conflict_dismissals" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.player_equipped_gear" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.player_equipped_gear" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.priority_order_confirmed_empty" }o--|| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.priority_order_confirmed_empty" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.priority_order_confirmed_empty" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.priority_stale_dismissals" }o--|| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.priority_stale_dismissals" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.priority_stale_dismissals" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.priority_stale_dismissals" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.raid_schedule" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.raid_schedule_exceptions" }o--o| "public.team_members" : "FOREIGN KEY (created_by) REFERENCES team_members(id) ON DELETE SET NULL"
"public.raid_schedule_exceptions" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.raid_rsvps" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.raid_rsvps" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.raid_rsvp_reminders_sent" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.raid_rsvp_reminders_sent" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.raid_signup_sheets" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.player_officer_notes" |o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.player_officer_notes" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.team_discord_config" |o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.track_bonus_ids" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"
"public.account_preferences" }o--o| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.retired_url_keys" }o--o| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.retired_url_keys" }o--|| "public.guilds" : "FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE"
"public.guild_grants" }o--|| "public.guilds" : "FOREIGN KEY (guild_id) REFERENCES guilds(id)"
"public.guild_grants" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id)"
"public.characters" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE"
"public.main_swap_requests" }o--o| "public.classes_specs" : "FOREIGN KEY (class_spec_id) REFERENCES classes_specs(id) ON UPDATE CASCADE"
"public.main_swap_requests" }o--o| "public.players" : "FOREIGN KEY (approved_player_id) REFERENCES players(id)"
"public.main_swap_requests" }o--|| "public.players" : "FOREIGN KEY (from_player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.main_swap_requests" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.main_swap_requests" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE"
"public.main_swap_requests" }o--o| "public.people" : "FOREIGN KEY (reviewed_by) REFERENCES people(id)"
"public.main_swap_requests" }o--o| "public.characters" : "FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL"
"public.boss_groups" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.boss_groups" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.boss_groups" }o--|| "public.raid_encounters" : "FOREIGN KEY (encounter_id) REFERENCES raid_encounters(id) ON DELETE CASCADE"
"public.raid_night_bosses" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.raid_night_bosses" }o--|| "public.raid_encounters" : "FOREIGN KEY (encounter_id) REFERENCES raid_encounters(id) ON DELETE CASCADE"
"public.raid_night_bosses" }o--o| "public.people" : "FOREIGN KEY (confirmed_by) REFERENCES people(id) ON DELETE SET NULL"
"public.raid_night_lineups" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.raid_night_lineups" }o--|| "public.raid_night_bosses" : "FOREIGN KEY (team_id, raid_date, encounter_id) REFERENCES raid_night_bosses(team_id, raid_date, encounter_id) ON DELETE CASCADE"
"public.team_lineup_settings" |o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.team_seasons" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.team_seasons" }o--|| "public.seasons" : "FOREIGN KEY (season_code) REFERENCES seasons(code)"
"public.team_invite_links" |o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.item_seasons" }o--|| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE"
"public.item_seasons" }o--|| "public.seasons" : "FOREIGN KEY (season) REFERENCES seasons(code)"

"public.attendance" {
  integer id
  integer team_id FK
  integer player_id FK
  date raid_date
  text status
  boolean report_excluded
  text report_id
  text source
  text report_title
}
"public.audit_log" {
  integer id
  integer team_id FK
  uuid actor_id FK
  text action
  text target_type
  integer target_id
  jsonb detail
  timestamp_with_time_zone created_at
}
"public.bis_requests" {
  integer id
  integer team_id FK
  integer player_id FK
  timestamp_with_time_zone submitted_at
  text status
  text bis_link
  text player_note
  text officer_notes
}
"public.classes_specs" {
  integer id
  text class
  text spec
  text role
}
"public.item_bosses" {
  integer item_id FK
  text boss
}
"public.items" {
  integer id
  integer wow_item_id
  text name
  text slot
  text armor_type
  integer sort_id
  boolean is_placeholder
  text icon
  jsonb secondary_stats
  integer wcl_zone_id
  boolean is_ptr
  jsonb main_stats
  text weapon_subtype
  boolean is_boe
  text source
}
"public.rclc_loot" {
  integer id
  integer team_id FK
  integer player_id FK
  integer item_id FK
  text track
  text season FK
  timestamp_with_time_zone awarded_at
  text rclc_id
  text dedupe_key
  text boss
  text response
}
"public.mplus_exclusion_requests" {
  integer id
  integer team_id FK
  integer player_id FK
  text reason
  timestamp_with_time_zone submitted_at
  text status
  text raiderio_url
  text officer_notes
  timestamp_with_time_zone updated_at
}
"public.player_wcl_season_perf" {
  integer id
  integer player_id FK
  integer team_id FK
  text season FK
  numeric best_perf_avg
  numeric median_perf_avg
  timestamp_with_time_zone fetched_at
}
"public.players" {
  integer id
  integer team_id FK
  text name_realm
  integer class_spec_id FK
  boolean is_trial
  boolean is_bench
  text nickname
  text bis_link
  date join_date
  boolean m_plus_excluded
  text m_plus_note
  integer team_member_id FK
  timestamp_with_time_zone archived_at
  timestamp_with_time_zone updated_at
  boolean bis_allowed
  boolean is_backup_tank
  boolean is_backup_healer
  boolean wishlist_allowed
  integer tier_pieces_equipped
  timestamp_with_time_zone tier_pieces_synced_at
  integer bonus_roll_encounter_id FK
  boolean is_rotator
  timestamp_with_time_zone bis_link_updated_at
  text url_code
  text name_realm_key
}
"public.priority_order" {
  integer id
  integer team_id FK
  text season FK
  integer item_id FK
  text track
  integer rank
  integer player_id FK
  timestamp_with_time_zone updated_at
}
"public.scoring" {
  integer id
  integer player_id FK
  numeric recent_score
  numeric trend_score
  numeric best_score
  numeric performance_score
  numeric attendance_score
  numeric attendance_pct
  text season FK
  timestamp_with_time_zone updated_at
  integer team_id FK
}
"public.season_signups" {
  integer id
  integer team_id FK
  text signup_name_realm
  integer class_spec_id FK
  text off_specs
  boolean main_swap
  text player_note
  timestamp_with_time_zone submitted_at
  text status
  integer swap_class_spec_id FK
  text season FK
  timestamp_with_time_zone reviewed_at
  integer reviewed_by FK
  text signup_officer_note
  integer approved_player_id FK
  timestamp_with_time_zone updated_at
  text swap_from_name_realm
  uuid auth_user_id FK
}
"public.self_received_requests" {
  integer id
  integer team_id FK
  integer player_id FK
  integer self_item_id FK
  timestamp_with_time_zone submitted_at
  text status
  text track
  text source
  text note
  text slot
  timestamp_with_time_zone updated_at
  text officer_notes
}
"public.team_members" {
  integer id
  integer team_id FK
  text discord_id
  uuid auth_user_id FK
  text role
  text name_realm
  timestamp_with_time_zone updated_at
  integer person_id FK
}
"public.team_settings" {
  integer team_id FK
  jsonb config
  timestamp_with_time_zone updated_at
}
"public.teams" {
  integer id
  text name
  text slug
  timestamp_with_time_zone archived_at
  integer wcl_guild_id
  integer guild_id FK
}
"public.pending_roster" {
  integer signup_id
  integer team_id
  text season
  text signup_name_realm
  integer class_spec_id
  text class
  text spec
  text role
  text off_specs
  boolean main_swap
  text player_note
  text signup_officer_note
  timestamp_with_time_zone reviewed_at
  integer reviewed_by
  text swap_from_name_realm
}
"public.rnlsi" {
  integer player_id
  integer team_id
  text name_realm
  text role
  timestamp_with_time_zone last_award_at
  bigint raid_nights_since_last_item
}
"public.bis_demand_vs_awards" {
  integer team_id
  integer item_id
  text item_name
  text slot
  bigint demand_count
  text season
  bigint awarded_count
}
"public.priority_order_stale_entries" {
  integer priority_order_id
  integer team_id
  text season
  integer item_id
  text item_name
  text track
  integer rank
  integer player_id
  text name_realm
  timestamp_with_time_zone archived_at
}
"public.priority_order_gaps" {
  integer team_id
  text season
  integer player_id
  text name_realm
}
"public.season_loot_pace" {
  integer team_id
  text season
  integer season_week
  text track
  text slot
  bigint items_awarded
}
"public.streamers" {
  integer id
  integer team_id FK
  integer player_id FK
  text twitch_channel
  text schedule_note
  boolean guild_wide_opt_out
  boolean is_live
  timestamp_with_time_zone last_checked_at
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
}
"public.notifications" {
  integer id
  integer team_id FK
  integer player_id FK
  text message
  boolean read
  timestamp_with_time_zone created_at
}
"public.raid_zones" {
  integer id
  integer wcl_zone_id
  text name
  text season FK
  boolean is_mini_raid
  integer sort_index
}
"public.raid_encounters" {
  integer id
  integer zone_id FK
  integer wcl_encounter_id
  text name
  integer sort_index
  integer cap
}
"public.team_raid_progress" {
  integer id
  integer team_id FK
  integer encounter_id FK
  date mythic_date
  date heroic_date
  integer mythic_pulls
  numeric_5_2_ mythic_best_pct
  text mythic_report_code
  integer mythic_fight_id
  timestamp_with_time_zone updated_at
  integer heroic_pulls
  numeric_5_2_ heroic_best_pct
  text heroic_report_code
  integer heroic_fight_id
}
"public.priority_order_live_first_prios" {
  integer priority_order_id
  integer team_id
  text season
  integer item_id
  text item_name
  text track
  integer player_id
  text name_realm
  text boss
}
"public.priority_order_first_prio_counts" {
  integer team_id
  text season
  integer player_id
  text name_realm
  bigint first_prio_count
}
"public.priority_order_same_boss_conflicts" {
  integer team_id
  text season
  text track
  text boss
  integer player_id
  text name_realm
  integer item_id
  text item_name
  integer other_item_id
  text other_item_name
}
"public.priority_order_stale_after_heroic" {
  integer priority_order_id
  integer team_id
  text season
  integer item_id
  text item_name
  integer player_id
  text name_realm
}
"public.item_preferences" {
  integer id
  integer team_id FK
  integer player_id FK
  integer item_id FK
  text status
  text note
  text slot
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
  text season FK
  boolean synced_bis
}
"public.site_settings" {
  integer id
  boolean maintenance_mode
  text maintenance_message
  timestamp_with_time_zone updated_at
  jsonb guild_officer_bios
  bigint boe_payout_floor
  bigint boe_payout_pivot
  jsonb gear_sync_last_cron_run
  jsonb gear_sync_last_officer_run
  boolean guild_creation_open
}
"public.incoming_roster" {
  integer signup_id
  integer team_id
  text signup_name_realm
  text class
  text spec
  text role
  text swap_from_name_realm
}
"public.tier_token_map" {
  integer id
  integer token_item_id FK
  text class
  integer resolved_item_id FK
  timestamp_with_time_zone created_at
  text season FK
}
"public.boe_items" {
  integer id
  integer team_id FK
  integer player_id FK
  text finder_name
  integer item_id FK
  text item_name
  text track
  text season FK
  text note
  text status
  timestamp_with_time_zone found_at
  timestamp_with_time_zone sold_at
  timestamp_with_time_zone payout_paid_at
  timestamp_with_time_zone retired_at
  bigint sale_price
  bigint finder_payout
  bigint guild_cut
  bigint payout_floor
  bigint payout_pivot
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
  boolean payout_donated
  text upgrade_rank
  bigint ah_fee
  text finder_discord_id
  timestamp_with_time_zone found_posted_at
}
"public.boe_listings" {
  integer id
  integer team_id FK
  integer boe_item_id FK
  timestamp_with_time_zone listed_at
  bigint price
  text note
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
}
"public.priority_conflict_dismissals" {
  integer id
  integer team_id FK
  integer player_id FK
  text season FK
  text boss
  text track
  uuid dismissed_by FK
  timestamp_with_time_zone dismissed_at
}
"public.player_equipped_gear" {
  integer id
  integer player_id FK
  text equipment_slot
  integer item_id
  integer item_level
  text track
  timestamp_with_time_zone synced_at
  integer__ bonus_list
  integer team_id FK
}
"public.priority_order_confirmed_empty" {
  integer team_id FK
  text season FK
  integer item_id FK
  text track
  timestamp_with_time_zone marked_at
}
"public.priority_stale_dismissals" {
  integer id
  integer team_id FK
  integer player_id FK
  text season FK
  integer item_id FK
  uuid dismissed_by FK
  timestamp_with_time_zone dismissed_at
}
"public.raid_schedule" {
  integer id
  integer team_id FK
  integer weekday
  time_without_time_zone start_time
  text timezone
  integer duration_minutes
  boolean active
  boolean is_optional
  timestamp_with_time_zone created_at
}
"public.raid_schedule_exceptions" {
  integer id
  integer team_id FK
  date raid_date
  text exception_type
  time_without_time_zone start_time
  integer duration_minutes
  boolean is_optional
  text note
  integer created_by FK
  timestamp_with_time_zone created_at
}
"public.raid_rsvps" {
  integer id
  integer team_id FK
  integer player_id FK
  date raid_date
  text status
  text note
  timestamp_with_time_zone created_at
  timestamp_with_time_zone updated_at
}
"public.raid_rsvp_reminders_sent" {
  integer id
  integer team_id FK
  integer player_id FK
  date raid_date
  text checkpoint
  timestamp_with_time_zone sent_at
}
"public.raid_signup_sheets" {
  integer id
  integer team_id FK
  date raid_date
  text channel_id
  text message_id
  timestamp_with_time_zone updated_at
}
"public.player_officer_notes" {
  integer player_id FK
  integer team_id FK
  text officer_notes
  text archived_reason
  text archived_reason_detail
  timestamp_with_time_zone updated_at
}
"public.team_discord_config" {
  integer team_id FK
  text guild_id
  text officer_channel_id
  text attendance_channel_id
  text signup_channel_id
  text mplus_ping_role_id
  text roster_ping_role_id
  text rsvp_ping_role_id
  text apps_script_url
  text roster_script_url
  timestamp_with_time_zone created_at
  timestamp_with_time_zone updated_at
}
"public.track_bonus_ids" {
  integer bonus_id
  text track
  smallint rank
  text season FK
  timestamp_with_time_zone created_at
}
"public.account_preferences" {
  bigint id
  uuid auth_user_id FK
  integer team_id FK
  text key
  jsonb value
  timestamp_with_time_zone set_at
}
"public.guilds" {
  integer id
  text name
  text url_key
  timestamp_with_time_zone created_at
  text region
  text realm
}
"public.retired_url_keys" {
  bigint id
  integer guild_id FK
  integer team_id FK
  text url_key
  timestamp_with_time_zone retired_at
}
"public.people" {
  integer id
  uuid auth_user_id FK
  text discord_id
  timestamp_with_time_zone created_at
}
"public.seasons" {
  text code
  text display_name
  date starts_at
  date ends_at
  timestamp_with_time_zone created_at
}
"public.guild_grants" {
  integer id
  integer person_id FK
  integer guild_id FK
  text grant_type
  timestamp_with_time_zone created_at
}
"public.site_admins" {
  integer id
  text discord_id
  uuid auth_user_id
  integer person_id
  timestamp_with_time_zone created_at
}
"public.guild_officers" {
  integer id
  text discord_id
  uuid auth_user_id
  integer person_id
  timestamp_with_time_zone created_at
}
"public.boe_managers" {
  integer id
  text discord_id
  uuid auth_user_id
  integer person_id
  timestamp_with_time_zone created_at
}
"public.characters" {
  integer id
  integer person_id FK
  bigint blizzard_id
  text name
  text realm
  text realm_slug
  text name_realm
  text name_realm_key
  text class_name
  text spec_name
  integer level
  integer item_level
  timestamp_with_time_zone saved_at
}
"public.main_swap_requests" {
  integer id
  integer team_id FK
  integer person_id FK
  integer from_player_id FK
  integer character_id FK
  text name_realm
  integer class_spec_id FK
  text note
  text status
  timestamp_with_time_zone requested_at
  timestamp_with_time_zone reviewed_at
  integer reviewed_by FK
  text officer_note
  integer approved_player_id FK
}
"public.boss_groups" {
  integer id
  integer team_id FK
  integer encounter_id FK
  integer player_id FK
  timestamp_with_time_zone created_at
}
"public.raid_night_bosses" {
  integer id
  integer team_id FK
  date raid_date
  integer encounter_id FK
  integer position
  boolean skipped
  timestamp_with_time_zone confirmed_at
  integer confirmed_by FK
  timestamp_with_time_zone created_at
}
"public.raid_night_lineups" {
  integer id
  integer team_id FK
  date raid_date FK
  integer encounter_id FK
  integer player_id FK
  timestamp_with_time_zone created_at
}
"public.team_lineup_settings" {
  integer team_id FK
  integer tanks_wanted
  integer healers_wanted
  timestamp_with_time_zone updated_at
}
"public.team_seasons" {
  bigint id
  integer team_id FK
  text season_code FK
  boolean signups_open
  boolean wishlist_open
  timestamp_with_time_zone updated_at
}
"public.team_invite_links" {
  integer team_id FK
  text code
  timestamp_with_time_zone expires_at
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
}
"public.item_seasons" {
  integer item_id FK
  text season FK
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
