# public.character_sims

## Description

A raider's latest droptimizer sim per difficulty, spec and setup (#1443, #1916, #1888): Raidbots or QE Live, written by save_character_sim().

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | bigint |  | false | [public.character_sim_results](public.character_sim_results.md) |  |  |
| team_id | integer |  | false |  | [public.teams](public.teams.md) |  |
| player_id | integer |  | false |  | [public.players](public.players.md) |  |
| difficulty | text |  | false |  |  |  |
| source | text |  | false |  |  |  |
| report_id | text |  | false |  |  |  |
| simmed_at | timestamp with time zone |  | false |  |  |  |
| fight_style | text |  | true |  |  |  |
| target_count | integer |  | true |  |  |  |
| added_by | integer |  | true |  | [public.people](public.people.md) |  |
| added_at | timestamp with time zone | now() | false |  |  |  |
| class_spec_id | integer |  | false |  | [public.classes_specs](public.classes_specs.md) | The spec the sim was run as (#1916). The character's roster spec's sim is the one the Priority page counts. |
| fight_length | integer |  | true |  |  | The fight length the sim was run at, in seconds (#1888); null for QE Live, and for sims saved before it was kept. |
| gear_item_level | numeric(6,2) |  | true |  |  | The raider's average equipped item level when the sim was saved, from the daily gear read (#1888); null when there was none. |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| character_sims_difficulty_check | CHECK | CHECK ((difficulty = ANY (ARRAY['lfr'::text, 'normal'::text, 'heroic'::text, 'mythic'::text]))) |
| character_sims_fight_length_check | CHECK | CHECK (((fight_length >= 1) AND (fight_length <= 3600))) |
| character_sims_fight_style_check | CHECK | CHECK ((char_length(fight_style) <= 40)) |
| character_sims_gear_item_level_check | CHECK | CHECK (((gear_item_level >= (1)::numeric) AND (gear_item_level <= (2000)::numeric))) |
| character_sims_report_id_check | CHECK | CHECK ((report_id ~ '^[A-Za-z0-9_-]{1,64}$'::text)) |
| character_sims_source_check | CHECK | CHECK ((source = ANY (ARRAY['raidbots'::text, 'qe_live'::text]))) |
| character_sims_target_count_check | CHECK | CHECK (((target_count >= 1) AND (target_count <= 100))) |
| character_sims_class_spec_id_fkey | FOREIGN KEY | FOREIGN KEY (class_spec_id) REFERENCES classes_specs(id) |
| character_sims_player_id_fkey | FOREIGN KEY | FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE |
| character_sims_team_id_fkey | FOREIGN KEY | FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE |
| character_sims_added_by_fkey | FOREIGN KEY | FOREIGN KEY (added_by) REFERENCES people(id) ON DELETE SET NULL |
| character_sims_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| character_sims_player_setup_key | UNIQUE | UNIQUE NULLS NOT DISTINCT (player_id, difficulty, class_spec_id, fight_style, target_count, fight_length) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| character_sims_pkey | CREATE UNIQUE INDEX character_sims_pkey ON public.character_sims USING btree (id) |
| character_sims_team_id_idx | CREATE INDEX character_sims_team_id_idx ON public.character_sims USING btree (team_id) |
| character_sims_player_setup_key | CREATE UNIQUE INDEX character_sims_player_setup_key ON public.character_sims USING btree (player_id, difficulty, class_spec_id, fight_style, target_count, fight_length) NULLS NOT DISTINCT |

## Relations

```mermaid
erDiagram

"public.character_sim_results" }o--|| "public.character_sims" : "FOREIGN KEY (sim_id) REFERENCES character_sims(id) ON DELETE CASCADE"
"public.character_sims" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.character_sims" }o--|| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE"
"public.character_sims" }o--o| "public.people" : "FOREIGN KEY (added_by) REFERENCES people(id) ON DELETE SET NULL"
"public.character_sims" }o--|| "public.classes_specs" : "FOREIGN KEY (class_spec_id) REFERENCES classes_specs(id)"

"public.character_sims" {
  bigint id
  integer team_id FK
  integer player_id FK
  text difficulty
  text source
  text report_id
  timestamp_with_time_zone simmed_at
  text fight_style
  integer target_count
  integer added_by FK
  timestamp_with_time_zone added_at
  integer class_spec_id FK
  integer fight_length
  numeric_6_2_ gear_item_level
}
"public.character_sim_results" {
  bigint id
  bigint sim_id FK
  integer wow_item_id
  text item_name
  text slot
  integer item_level
  numeric pct_gain
  numeric dps_gain
  integer encounter_id
  integer catalyst_from
}
"public.teams" {
  integer id
  text name
  text slug
  timestamp_with_time_zone archived_at
  integer wcl_guild_id
  integer guild_id FK
  boolean unlisted
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
  timestamp_with_time_zone bis_link_updated_at
  text url_code
  text name_realm_key
}
"public.people" {
  integer id
  uuid auth_user_id FK
  text discord_id
  timestamp_with_time_zone created_at
}
"public.classes_specs" {
  integer id
  text class
  text spec
  text role
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
