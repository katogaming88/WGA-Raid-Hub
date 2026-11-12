// The production side of recruit-reminders: supabase-js behind ReminderDb, as
// the service role (the cron caller has no login). The only module that
// imports supabase-js.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { type Deps, type Rec, type ReminderDb } from './handler.ts';

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

const TIMINGS =
  'dm_reply_after_minutes, remind_after_hours, close_no_reply_after_hours, ping_officers_after_hours,' +
  ' ping_owner_after_hours, trial_end_notice_hours';

function supabaseDb(): ReminderDb {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  return {
    async openRecords() {
      // ponytail: one read per table across every open record; past 1000 open
      // records (or their history rows) PostgREST truncates, and this needs
      // paging.
      const apps = check(
        await db
          .from('recruit_applications')
          .select(
            'id, team_id, person_id, status, name_realm, time_zone, applicant_last_message_at,' +
              ' officers_last_message_at, applied_at, trial_ends_on, discord_channel_id, discord_thread_id'
          )
          .is('closed_at', null)
          .in('status', ['waiting_on_officers', 'waiting_on_applicant', 'on_trial'])
      ) as any[];
      if (!apps.length) return [];
      const teamIds = [...new Set(apps.map((a) => a.team_id))];

      const [teams, recruiting, discord, owners, events] = await Promise.all([
        db.from('teams').select('id, name').in('id', teamIds).then(check),
        db
          .from('team_recruiting')
          .select('team_id, discord_mode, ' + TIMINGS)
          .in('team_id', teamIds)
          .then(check),
        db
          .from('team_discord_config')
          .select('team_id, guild_id, officer_channel_id')
          .in('team_id', teamIds)
          .then(check),
        db
          .from('team_members')
          .select('team_id, person_id')
          .in('team_id', teamIds)
          .eq('rank', 'owner')
          .is('archived_at', null)
          .then(check),
        db
          .from('recruit_events')
          .select('application_id, created_at')
          .in(
            'application_id',
            apps.map((a) => a.id)
          )
          .neq('kind', 'reminder_sent')
          .then(check)
      ]);
      const personIds = [
        ...new Set([...apps.map((a) => a.person_id), ...(owners as any[]).map((o) => o.person_id)].filter(Boolean))
      ];
      const people = personIds.length
        ? (check(await db.from('people').select('id, discord_id').in('id', personIds)) as any[])
        : [];

      const by = <T>(rows: T[], key: (r: T) => number) => new Map(rows.map((r) => [key(r), r]));
      const teamOf = by(teams as any[], (t) => t.id);
      const settingsOf = by(recruiting as any[], (r) => r.team_id);
      const discordOf = by(discord as any[], (d) => d.team_id);
      const ownerOf = by(owners as any[], (o) => o.team_id);
      const discordId = new Map(people.map((p) => [p.id, p.discord_id as string | null]));
      const lastActivity = new Map<number, string>();
      for (const e of events as any[]) {
        const was = lastActivity.get(e.application_id);
        if (!was || Date.parse(e.created_at) > Date.parse(was)) lastActivity.set(e.application_id, e.created_at);
      }

      return apps.map((a): Rec => {
        const s = settingsOf.get(a.team_id) as any;
        const d = discordOf.get(a.team_id) as any;
        const owner = ownerOf.get(a.team_id) as any;
        return {
          id: a.id,
          team_name: (teamOf.get(a.team_id) as any)?.name ?? 'The team',
          status: a.status,
          name_realm: a.name_realm,
          applicant_discord_id: a.person_id ? (discordId.get(a.person_id) ?? null) : null,
          time_zone: a.time_zone,
          applicant_last_message_at: a.applicant_last_message_at,
          officers_last_message_at: a.officers_last_message_at,
          applied_at: a.applied_at,
          last_activity_at: lastActivity.get(a.id) ?? null,
          trial_ends_on: a.trial_ends_on,
          uses_ticket: s?.discord_mode === 'ticket',
          ticket_channel_id: a.discord_channel_id,
          thread_id: a.discord_thread_id,
          server_id: d?.guild_id ?? null,
          officer_channel_id: d?.officer_channel_id ?? null,
          owner_discord_id: owner ? (discordId.get(owner.person_id) ?? null) : null,
          timings: {
            dm_reply_after_minutes: s?.dm_reply_after_minutes ?? null,
            remind_after_hours: s?.remind_after_hours ?? null,
            close_no_reply_after_hours: s?.close_no_reply_after_hours ?? null,
            ping_officers_after_hours: s?.ping_officers_after_hours ?? null,
            ping_owner_after_hours: s?.ping_owner_after_hours ?? null,
            trial_end_notice_hours: s?.trial_end_notice_hours ?? null
          }
        };
      });
    },

    async saveTimes(id, times) {
      check(await db.from('recruit_applications').update(times).eq('id', id).is('closed_at', null));
    },

    async claim(id, reminder, dueFor) {
      const rows = check(
        await db
          .from('recruit_reminders_sent')
          .upsert(
            { application_id: id, reminder, due_for: dueFor },
            { onConflict: 'application_id,reminder,due_for', ignoreDuplicates: true }
          )
          .select('id')
      ) as any[];
      return rows.length > 0;
    },

    async unclaim(id, reminder, dueFor) {
      check(
        await db
          .from('recruit_reminders_sent')
          .delete()
          .eq('application_id', id)
          .eq('reminder', reminder)
          .eq('due_for', dueFor)
      );
    },

    async sent(id, detail) {
      check(await db.from('recruit_events').insert({ application_id: id, kind: 'reminder_sent', detail }));
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, db: supabaseDb(), env: Deno.env, now: () => new Date() };
}
