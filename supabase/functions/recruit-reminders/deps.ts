// The production side of recruit-reminders: supabase-js behind ReminderDb, as
// the service role (the cron caller has no login). The only module that
// imports supabase-js.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { type Deps, type Rec, type ReminderDb } from './handler.ts';
import { type TicketRec } from './tickets.ts';

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

const TIMINGS =
  'dm_reply_after_minutes, remind_after_hours, close_no_reply_after_hours, ping_officers_after_hours,' +
  ' ping_owner_after_hours, trial_end_notice_hours';

// PostgREST answers at most 1000 rows and says nothing, so a short page looks
// like the whole table; read page by page until one comes back short.
const PAGE = 1000;
async function paged(
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const got = check(await page(from, from + PAGE - 1)) ?? [];
    rows.push(...got);
    if (got.length < PAGE) return rows;
  }
}

function supabaseDb(): ReminderDb {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Linked Discord ids by person, in batches well under PostgREST's 1000-row
  // answer and the address length.
  async function discordIds(personIds: number[]) {
    const ids = new Map<number, string | null>();
    for (let i = 0; i < personIds.length; i += 200) {
      const rows = check(
        await db
          .from('people')
          .select('id, discord_id')
          .in('id', personIds.slice(i, i + 200))
      ) as any[];
      for (const p of rows) ids.set(p.id, p.discord_id);
    }
    return ids;
  }

  return {
    async closeNoReply(id) {
      return check(await db.rpc('bot_close_no_reply', { p_application_id: id })) === true;
    },

    async closingTickets() {
      // A saved closed ticket of a team that never deletes has nothing left
      // to do; leaving those out keeps the read from growing for good.
      const keep = (
        check(await db.from('team_recruiting').select('team_id').is('delete_closed_after_hours', null)) as any[]
      ).map((r) => r.team_id);
      const apps = await paged((from, to) => {
        const q = db
          .from('recruit_applications')
          .select(
            'id, team_id, person_id, status, closed_at, name_realm, discord_channel_id, discord_thread_id,' +
              ' ticket_closed_at, ticket_saved_at, ticket_save_failures'
          )
          .is('ticket_deleted_at', null)
          .or(
            'and(closed_at.not.is.null,discord_channel_id.not.is.null),' +
              'and(closed_at.not.is.null,discord_thread_id.not.is.null),' +
              'ticket_closed_at.not.is.null'
          );
        return (
          keep.length ? q.or('closed_at.is.null,ticket_saved_at.is.null,team_id.not.in.(' + keep.join(',') + ')') : q
        )
          .order('id')
          .range(from, to);
      });
      if (!apps.length) return [];
      const teamIds = [...new Set(apps.map((a) => a.team_id))];
      const [teams, recruiting, discord] = await Promise.all([
        db.from('teams').select('id, name').in('id', teamIds).then(check),
        db.from('team_recruiting').select('team_id, delete_closed_after_hours').in('team_id', teamIds).then(check),
        db.from('team_discord_config').select('team_id, officer_channel_id').in('team_id', teamIds).then(check)
      ]);
      const discordId = await discordIds([...new Set(apps.map((a) => a.person_id).filter(Boolean))]);
      const by = <T>(rows: T[], key: (r: T) => number) => new Map(rows.map((r) => [key(r), r]));
      const teamOf = by(teams as any[], (t) => t.id);
      const settingsOf = by(recruiting as any[], (r) => r.team_id);
      const discordOf = by(discord as any[], (d) => d.team_id);
      return apps.map((a): TicketRec => ({
        id: a.id,
        team_name: (teamOf.get(a.team_id) as any)?.name ?? 'The team',
        status: a.status,
        open: a.closed_at === null,
        name_realm: a.name_realm,
        applicant_discord_id: a.person_id ? (discordId.get(a.person_id) ?? null) : null,
        channel_id: a.discord_channel_id,
        thread_id: a.discord_thread_id,
        officer_channel_id: (discordOf.get(a.team_id) as any)?.officer_channel_id ?? null,
        ticket_closed_at: a.ticket_closed_at,
        ticket_saved_at: a.ticket_saved_at,
        ticket_save_failures: a.ticket_save_failures ?? 0,
        delete_after_hours: (settingsOf.get(a.team_id) as any)?.delete_closed_after_hours ?? null
      }));
    },

    async reopenedAfterDelete() {
      const rows = await paged((from, to) =>
        db
          .from('recruit_applications')
          .select('id, team_id')
          .is('closed_at', null)
          .not('ticket_deleted_at', 'is', null)
          .order('id')
          .range(from, to)
      );
      if (!rows.length) return [];
      // An archived team's records wait until it's back, as in openRecords().
      const archived = new Set(
        (
          check(
            await db
              .from('teams')
              .select('id')
              .in('id', [...new Set(rows.map((r) => r.team_id))])
              .not('archived_at', 'is', null)
          ) as any[]
        ).map((t) => t.id)
      );
      return rows.filter((r) => !archived.has(r.team_id)).map((r) => r.id);
    },

    async claimDelete(id, at) {
      const rows = check(
        await db
          .from('recruit_applications')
          .update({ ticket_deleted_at: at })
          .eq('id', id)
          .not('closed_at', 'is', null)
          .is('ticket_deleted_at', null)
          .select('id')
      ) as any[];
      return rows.length > 0;
    },

    async ticketProgress(id, progress) {
      check(await db.from('recruit_applications').update(progress).eq('id', id));
    },

    async saveMessages(id, messages) {
      for (let i = 0; i < messages.length; i += 500) {
        check(
          await db.from('recruit_messages').upsert(
            messages.slice(i, i + 500).map((m) => ({ application_id: id, ...m })),
            { onConflict: 'application_id,discord_message_id', ignoreDuplicates: true }
          )
        );
      }
    },

    async openRecords() {
      const apps = await paged((from, to) =>
        db
          .from('recruit_applications')
          .select(
            'id, team_id, person_id, status, name_realm, time_zone, applicant_last_message_at,' +
              ' officers_last_message_at, applied_at, trial_ends_on, discord_channel_id, discord_thread_id'
          )
          .is('closed_at', null)
          .in('status', ['waiting_on_officers', 'waiting_on_applicant', 'on_trial'])
          .order('id')
          .range(from, to)
      );
      if (!apps.length) return [];
      const teamIds = [...new Set(apps.map((a) => a.team_id))];

      const [teams, recruiting, discord, owners, events] = await Promise.all([
        db.from('teams').select('id, name, archived_at').in('id', teamIds).then(check),
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
        // Every open record's history, by the record's own filter rather than a
        // list of ids, which could outgrow the address.
        paged((from, to) =>
          db
            .from('recruit_events')
            .select('id, application_id, kind, created_at, recruit_applications!inner(closed_at)')
            .is('recruit_applications.closed_at', null)
            .neq('kind', 'reminder_sent')
            .order('id')
            .range(from, to)
        )
      ]);
      const personIds = [
        ...new Set([...apps.map((a) => a.person_id), ...(owners as any[]).map((o) => o.person_id)].filter(Boolean))
      ];
      const discordId = await discordIds(personIds);

      const by = <T>(rows: T[], key: (r: T) => number) => new Map(rows.map((r) => [key(r), r]));
      const teamOf = by(teams as any[], (t) => t.id);
      const settingsOf = by(recruiting as any[], (r) => r.team_id);
      const discordOf = by(discord as any[], (d) => d.team_id);
      const ownerOf = by(owners as any[], (o) => o.team_id);
      const lastActivity = new Map<number, string>();
      const lastReopen = new Map<number, string>();
      const keep = (m: Map<number, string>, id: number, at: string) => {
        const was = m.get(id);
        if (!was || Date.parse(at) > Date.parse(was)) m.set(id, at);
      };
      for (const e of events as any[]) {
        keep(lastActivity, e.application_id, e.created_at);
        if (e.kind === 'reopened') keep(lastReopen, e.application_id, e.created_at);
      }

      // An archived team's records wait until it's back: its records can't
      // be changed meanwhile (recruit_lock()), so No reply would fail each sweep.
      return apps
        .filter((a) => !(teamOf.get(a.team_id) as any)?.archived_at)
        .map((a): Rec => {
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
            reopened_at: lastReopen.get(a.id) ?? null,
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
