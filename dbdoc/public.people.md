# public.people

## Description

One row per human (#942). auth_user_id is their sign-in account, null for a Discord id listed on a grant before its owner signed in. discord_id is null for an account with no Discord linked. Grant tables point here through person_id.

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | integer |  | false | [public.season_signups](public.season_signups.md) [public.team_members](public.team_members.md) [public.guild_grants](public.guild_grants.md) [public.characters](public.characters.md) [public.main_swap_requests](public.main_swap_requests.md) [public.raid_night_bosses](public.raid_night_bosses.md) [public.removal_reasons](public.removal_reasons.md) [public.team_raid_reports](public.team_raid_reports.md) [public.guild_ranks](public.guild_ranks.md) [public.discord_server_access](public.discord_server_access.md) [public.guild_recruiters](public.guild_recruiters.md) [public.recruit_applications](public.recruit_applications.md) [public.recruit_notes](public.recruit_notes.md) [public.recruit_events](public.recruit_events.md) |  |  |
| auth_user_id | uuid |  | true |  |  |  |
| discord_id | text |  | true |  |  |  |
| created_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| people_auth_user_id_fkey | FOREIGN KEY | FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL |
| people_pkey | PRIMARY KEY | PRIMARY KEY (id) |
| people_auth_user_id_key | UNIQUE | UNIQUE (auth_user_id) |
| people_discord_id_key | UNIQUE | UNIQUE (discord_id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| people_pkey | CREATE UNIQUE INDEX people_pkey ON public.people USING btree (id) |
| people_auth_user_id_key | CREATE UNIQUE INDEX people_auth_user_id_key ON public.people USING btree (auth_user_id) |
| people_discord_id_key | CREATE UNIQUE INDEX people_discord_id_key ON public.people USING btree (discord_id) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| people_delete_when_empty | CREATE TRIGGER people_delete_when_empty AFTER UPDATE OF auth_user_id, discord_id ON public.people FOR EACH ROW WHEN (((new.auth_user_id IS NULL) AND (new.discord_id IS NULL))) EXECUTE FUNCTION delete_empty_person() |
| people_copy_account_to_members | CREATE TRIGGER people_copy_account_to_members AFTER UPDATE OF auth_user_id ON public.people FOR EACH ROW WHEN ((old.auth_user_id IS DISTINCT FROM new.auth_user_id)) EXECUTE FUNCTION copy_person_account_to_members() |

## Relations

```mermaid
erDiagram

"public.season_signups" }o--o| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL"
"public.team_members" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id)"
"public.guild_grants" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id)"
"public.characters" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE"
"public.main_swap_requests" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE"
"public.main_swap_requests" }o--o| "public.people" : "FOREIGN KEY (reviewed_by) REFERENCES people(id)"
"public.raid_night_bosses" }o--o| "public.people" : "FOREIGN KEY (confirmed_by) REFERENCES people(id) ON DELETE SET NULL"
"public.removal_reasons" }o--o| "public.people" : "FOREIGN KEY (removed_by) REFERENCES people(id) ON DELETE SET NULL"
"public.team_raid_reports" }o--o| "public.people" : "FOREIGN KEY (kind_override_by) REFERENCES people(id) ON DELETE SET NULL"
"public.guild_ranks" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id)"
"public.discord_server_access" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE"
"public.guild_recruiters" }o--|| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE"
"public.recruit_applications" }o--o| "public.people" : "FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL"
"public.recruit_applications" }o--o| "public.people" : "FOREIGN KEY (recruiter_person_id) REFERENCES people(id) ON DELETE SET NULL"
"public.recruit_notes" }o--o| "public.people" : "FOREIGN KEY (author_person_id) REFERENCES people(id) ON DELETE SET NULL"
"public.recruit_events" }o--o| "public.people" : "FOREIGN KEY (actor_person_id) REFERENCES people(id) ON DELETE SET NULL"

"public.people" {
  integer id
  uuid auth_user_id FK
  text discord_id
  timestamp_with_time_zone created_at
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
  integer person_id FK
  integer character_id FK
  boolean is_trial
  boolean is_backup_tank
  boolean is_backup_healer
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
  text rank
}
"public.guild_grants" {
  integer id
  integer person_id FK
  integer guild_id FK
  text grant_type
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
  integer skipped_for_kill_id FK
}
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
"public.team_raid_reports" {
  integer team_id FK
  text report_code
  text title
  timestamp_with_time_zone started_at
  date raid_date
  integer wcl_zone_id
  integer boss_pulls
  integer boss_kills
  text kind
  text kind_override
  integer kind_override_by FK
  timestamp_with_time_zone kind_override_at
  text effective_kind
  timestamp_with_time_zone created_at
  timestamp_with_time_zone updated_at
}
"public.guild_ranks" {
  integer guild_id FK
  integer person_id FK
  text rank
  timestamp_with_time_zone created_at
}
"public.discord_server_access" {
  integer person_id FK
  text server_id
  timestamp_with_time_zone verified_at
}
"public.guild_recruiters" {
  integer guild_id FK
  integer person_id FK
  text code
  boolean active
  timestamp_with_time_zone created_at
  timestamp_with_time_zone updated_at
}
"public.recruit_applications" {
  integer id
  integer team_id FK
  integer person_id FK
  text source
  text status
  integer character_id FK
  text name_realm
  text class_name
  text spec_name
  text__ other_specs
  integer item_level
  numeric_6_1_ mplus_score
  numeric_4_1_ logs_best_average
  numeric_4_1_ logs_median_average
  integer mythic_bosses_killed
  jsonb answers
  text sent_by
  integer recruiter_person_id FK
  text recruiter_code
  text sent_by_name
  text time_zone
  timestamp_with_time_zone applicant_last_message_at
  timestamp_with_time_zone officers_last_message_at
  date trial_starts_on
  date trial_ends_on
  text discord_channel_id
  text discord_thread_id
  text discord_officer_message_id
  timestamp_with_time_zone applied_at
  timestamp_with_time_zone closed_at
}
"public.recruit_notes" {
  integer id
  integer application_id FK
  integer author_person_id FK
  text source
  text body
  timestamp_with_time_zone created_at
}
"public.recruit_events" {
  integer id
  integer application_id FK
  text kind
  integer actor_person_id FK
  text detail
  timestamp_with_time_zone created_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
