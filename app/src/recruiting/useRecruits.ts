import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { RecruitList, RecruitRecord } from './recruits';

// The Recruits page's reads and writes (#1549). Each is asked of the database
// as the signed-in person, which refuses anyone the team doesn't let in
// (recruit_access()), so a hidden button is a courtesy, never the check.

const listKey = (teamId: number) => ['team-recruits', teamId] as const;
const recordKey = (id: number) => ['recruit-record', id] as const;

// The list also feeds the sidebar's count, so `enabled` lets the shell ask only
// for someone who may open the page.
export function useTeamRecruits(teamId: number, enabled = true) {
  return useSupabaseQuery<RecruitList>(
    listKey(teamId),
    async (client) => {
      const { data, error } = await client.rpc('team_recruits', { p_team_id: teamId });
      return { data: data as unknown as RecruitList, error };
    },
    { enabled }
  );
}

export function useRecruitRecord(id: number | null) {
  return useSupabaseQuery<RecruitRecord>(
    recordKey(id ?? 0),
    async (client) => {
      const { data, error } = await client.rpc('recruit_record', { p_application_id: id! });
      return { data: data as unknown as RecruitRecord, error };
    },
    { enabled: id !== null }
  );
}

const refreshes = [['team-recruits'], ['recruit-record']] as const;

export type Action =
  | { kind: 'note'; id: number; body: string }
  | { kind: 'start'; id: number }
  | { kind: 'decline'; id: number; reason: string }
  | { kind: 'reopen'; id: number }
  | { kind: 'joined'; id: number }
  | { kind: 'extend'; id: number; reason: string }
  | { kind: 'not_joining'; id: number; reason: string; detail: string };

// One mutation for every button on a recruit, so the page shows one error and
// one pending state and every write refreshes the list and the record.
export function useRecruitAction() {
  return useSupabaseMutation<unknown, Action>(
    (client, a) => {
      switch (a.kind) {
        case 'note':
          return client.rpc('add_recruit_note', { p_application_id: a.id, p_body: a.body });
        case 'start':
          return client.rpc('start_recruit_trial', { p_application_id: a.id });
        case 'decline':
          return client.rpc('close_recruit', {
            p_application_id: a.id,
            p_status: 'declined',
            p_reason: a.reason || (null as never)
          });
        case 'reopen':
          return client.rpc('reopen_recruit', { p_application_id: a.id });
        case 'joined':
          return client.rpc('mark_recruit_joined', { p_application_id: a.id });
        case 'extend':
          return client.rpc('extend_recruit_trial', { p_application_id: a.id, p_reason: a.reason });
        case 'not_joining':
          return client.rpc('mark_recruit_not_joining', {
            p_application_id: a.id,
            p_reason: a.reason,
            p_detail: a.detail || (null as never)
          });
      }
    },
    { key: ['recruit-action'], refreshes }
  );
}
