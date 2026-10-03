# public.removal_reasons

## Description

Every reason a character or a membership was removed for (#1427), never updated or deleted. A character's row comes from a trigger on player_officer_notes, a membership's from archive_team_member(). The notes row still holds the latest reason; this holds all of them.

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | bigint |  | false |  |  |  |
| team_id | integer |  | false |  | [public.teams](public.teams.md) |  |
| player_id | integer |  | true |  | [public.players](public.players.md) | The character removed. Null on a membership's own row (archive_team_member()). |
| team_member_id | integer |  | true |  | [public.team_members](public.team_members.md) | The membership: the one ended, on a membership's row, or the one the character was linked to when it was removed. Rows copied from the audit log carry the character's link as it stood when they were copied. |
| removed_at | timestamp with time zone | now() | false |  |  | When they were removed: the character's archived_at, so a correction written later stays under the same removal. One row per removal, reason and detail. |
| reason | text |  | false |  |  |  |
| detail | text |  | true |  |  |  |
| removed_by | integer |  | true |  | [public.people](public.people.md) | The person who removed them, from my_person_id(); null for a write with nobody signed in, and for an audit entry whose account has no person. |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| removal_reasons_about_someone | CHECK | CHECK (((player_id IS NOT NULL) OR (team_member_id IS NOT NULL))) |
| removal_reasons_reason_check | CHECK | CHECK ((reason = ANY (ARRAY['schedule_conflict'::text, 'performance'::text, 'drama'::text, 'moved_guilds'::text, 'switching_mains'::text, 'other'::text]))) |
| removal_reasons_player_id_fkey | FOREIGN KEY | FOREIGN KEY (player_id) REFERENCES players(id) |
| removal_reasons_team_member_id_fkey | FOREIGN KEY | FOREIGN KEY (team_member_id) REFERENCES team_members(id) |
| removal_reasons_team_id_fkey | FOREIGN KEY | FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE |
| removal_reasons_removed_by_fkey | FOREIGN KEY | FOREIGN KEY (removed_by) REFERENCES people(id) ON DELETE SET NULL |
| removal_reasons_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| removal_reasons_pkey | CREATE UNIQUE INDEX removal_reasons_pkey ON public.removal_reasons USING btree (id) |
| removal_reasons_team_id_idx | CREATE INDEX removal_reasons_team_id_idx ON public.removal_reasons USING btree (team_id) |
| removal_reasons_player_id_idx | CREATE INDEX removal_reasons_player_id_idx ON public.removal_reasons USING btree (player_id) |
| removal_reasons_team_member_id_idx | CREATE INDEX removal_reasons_team_member_id_idx ON public.removal_reasons USING btree (team_member_id) |
| removal_reasons_one_per_reason | CREATE UNIQUE INDEX removal_reasons_one_per_reason ON public.removal_reasons USING btree (player_id, removed_at, reason, detail) NULLS NOT DISTINCT WHERE (player_id IS NOT NULL) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| trg_removal_reasons_team_id_check | CREATE TRIGGER trg_removal_reasons_team_id_check BEFORE INSERT OR UPDATE ON public.removal_reasons FOR EACH ROW EXECUTE FUNCTION check_team_id_matches_player() |
| trg_removal_reasons_membership_team_check | CREATE TRIGGER trg_removal_reasons_membership_team_check BEFORE INSERT OR UPDATE ON public.removal_reasons FOR EACH ROW EXECUTE FUNCTION check_removal_reason_membership_team() |

## Relations

```mermaid
erDiagram

"public.removal_reasons" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.removal_reasons" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id)"
"public.removal_reasons" }o--o| "public.team_members" : "FOREIGN KEY (team_member_id) REFERENCES team_members(id)"
"public.removal_reasons" }o--o| "public.people" : "FOREIGN KEY (removed_by) REFERENCES people(id) ON DELETE SET NULL"

"public.removal_reasons" {
  bigint id
  integer team_id FK
  integer player_id FK
  integer team_member_id FK
  timestamp_with_time_zone removed_at
  text reason
  text detail
  integer removed_by FK
}
"public.teams" {
  integer id
  text name
  text slug
  timestamp_with_time_zone archived_at
  integer wcl_guild_id
  integer guild_id FK
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
"public.team_members" {
  integer id
  integer team_id FK
  text discord_id
  uuid auth_user_id FK
  text role
  text name_realm
  timestamp_with_time_zone updated_at
  integer person_id FK
  timestamp_with_time_zone archived_at
}
"public.people" {
  integer id
  uuid auth_user_id FK
  text discord_id
  timestamp_with_time_zone created_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
