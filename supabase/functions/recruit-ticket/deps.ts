// The production side of recruit-ticket: supabase-js behind TicketDb. The only
// module that imports supabase-js.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { type Deps, type Mode, type Ticket, type TicketDb, type Visibility, viewerIds } from './handler.ts';

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

function supabaseDb(): TicketDb {
  // The caller's own token answers who they are. The reads and writes are the
  // service role's: the application is the caller's own open one, and the
  // team-side reads (its settings, ranks and the officers' Discord ids) are
  // ones the applicant can't make. Those stay in this function: they build the
  // Discord permissions and mentions, and never reach the answer (a test
  // checks it).
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

  let service: SupabaseClient<any> | undefined;
  const db = () => {
    if (!service) {
      service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    }
    return service;
  };

  return {
    async getUser(authHeader) {
      const {
        data: { user }
      } = await caller(authHeader).auth.getUser();
      return user ? { id: user.id } : null;
    },

    async ticket(authUserId, applicationId) {
      // The applicant's own open record, or with no caller (the sweep's
      // fresh ticket, #1544) the open record itself.
      const person = authUserId
        ? check(await db().from('people').select('id, discord_id').eq('auth_user_id', authUserId).maybeSingle())
        : check(
            await db()
              .from('people')
              .select('id, discord_id')
              .eq(
                'id',
                (
                  check(
                    await db().from('recruit_applications').select('person_id').eq('id', applicationId).maybeSingle()
                  ) as any
                )?.person_id ?? -1
              )
              .maybeSingle()
          );
      if (!person) return null;
      const app = check(
        await db()
          .from('recruit_applications')
          .select(
            'id, team_id, person_id, character_id, name_realm, class_name, spec_name, other_specs, item_level,' +
              ' mplus_score, logs_best_average, mythic_bosses_killed, answers, sent_by, sent_by_name,' +
              ' discord_channel_id, discord_thread_id, discord_officer_message_id, applied_at, ticket_deleted_at'
          )
          .eq('id', applicationId)
          .eq('person_id', person.id)
          .is('closed_at', null)
          .maybeSingle()
      ) as any;
      if (!app) return null;

      const [team, recruiting, discord, character, before, opened] = await Promise.all([
        db().from('teams').select('name, slug, guild_id, guilds(name)').eq('id', app.team_id).single().then(check),
        db().from('team_recruiting').select('*').eq('team_id', app.team_id).maybeSingle().then(check),
        db()
          .from('team_discord_config')
          .select('guild_id, officer_channel_id')
          .eq('team_id', app.team_id)
          .maybeSingle()
          .then(check),
        app.character_id
          ? db().from('characters').select('name, realm_slug').eq('id', app.character_id).maybeSingle().then(check)
          : Promise.resolve(null),
        // Their latest earlier record with this team, for the card's link.
        db()
          .from('recruit_applications')
          .select('id')
          .eq('team_id', app.team_id)
          .eq('person_id', person.id)
          .neq('id', app.id)
          // Earlier by (applied_at, id), so a tie still finds the other one.
          .or('applied_at.lt.' + app.applied_at + ',and(applied_at.eq.' + app.applied_at + ',id.lt.' + app.id + ')')
          .order('applied_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db()
          .from('recruit_events')
          .select('detail')
          .eq('application_id', app.id)
          .eq('kind', 'ticket_opened')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(check)
      ]);
      if (before.error) throw new Error(before.error.message);
      const r = recruiting as any;

      // Who sees it: viewerIds() picks from the team's and guild's ranks.
      const visibility: Visibility = {
        visible_to_team_officers: r?.visible_to_team_officers !== false,
        visible_to_team_assistants: r?.visible_to_team_assistants === true,
        visible_to_guild_admins: r?.visible_to_guild_admins === true
      };
      const [members, guildRanks] = await Promise.all([
        db()
          .from('team_members')
          .select('team_id, person_id, rank, archived_at')
          .eq('team_id', app.team_id)
          .is('archived_at', null)
          .then(check),
        db()
          .from('guild_ranks')
          .select('guild_id, person_id, rank')
          .eq('guild_id', (team as any).guild_id)
          .in('rank', ['owner', 'admin'])
          .then(check)
      ]);
      const ids = [...new Set([...(members as any[]), ...(guildRanks as any[])].map((p) => p.person_id))];
      const linked = ids.length
        ? (check(await db().from('people').select('id, discord_id').in('id', ids)) as any[])
        : [];
      const viewers = viewerIds(
        { id: app.team_id, guild_id: (team as any).guild_id },
        visibility,
        members as any[],
        guildRanks as any[],
        new Map(linked.map((p) => [p.id, p.discord_id])),
        person.discord_id ?? null
      );

      return {
        id: app.id,
        team_id: app.team_id,
        team_name: (team as any).name,
        guild_name: (team as any).guilds?.name ?? (team as any).name,
        team_slug: (team as any).slug,
        person_id: app.person_id,
        discord_id: person.discord_id ?? null,
        name_realm: app.name_realm,
        character: (character as any) ?? null,
        class_name: app.class_name,
        spec_name: app.spec_name,
        other_specs: app.other_specs ?? [],
        item_level: app.item_level,
        mplus_score: app.mplus_score === null ? null : Number(app.mplus_score),
        logs_best_average: app.logs_best_average === null ? null : Number(app.logs_best_average),
        mythic_bosses_killed: app.mythic_bosses_killed,
        answers: Array.isArray(app.answers) ? app.answers : [],
        sent_by: app.sent_by,
        sent_by_name: app.sent_by_name,
        applied_before: (before.data as any)?.id ?? null,
        reopened: app.ticket_deleted_at !== null,
        ticket_deleted_at: app.ticket_deleted_at,
        discord_channel_id: app.discord_channel_id,
        discord_thread_id: app.discord_thread_id,
        discord_officer_message_id: app.discord_officer_message_id,
        opened_detail: (opened as any)?.detail ?? null,
        mode: (r?.discord_mode ?? 'none') as Mode,
        thread_with_ticket: r?.officer_thread_with_ticket === true,
        server_id: (discord as any)?.guild_id ?? null,
        officer_channel_id: (discord as any)?.officer_channel_id ?? null,
        ticket_category_id: r?.ticket_category_id ?? null,
        role_ids: r?.visible_to_role_ids ?? [],
        viewer_ids: viewers
      } satisfies Ticket;
    },

    async claim(applicationId, key, deletedAt) {
      const rows = check(
        await db()
          .from('recruit_reminders_sent')
          .upsert(
            { application_id: applicationId, reminder: key, due_for: deletedAt },
            { onConflict: 'application_id,reminder,due_for', ignoreDuplicates: true }
          )
          .select('id')
      ) as any[];
      return rows.length > 0;
    },

    async unclaim(applicationId, key, deletedAt) {
      check(
        await db()
          .from('recruit_reminders_sent')
          .delete()
          .eq('application_id', applicationId)
          .eq('reminder', key)
          .eq('due_for', deletedAt)
      );
    },

    async stopFresh(applicationId) {
      check(await db().from('recruit_applications').update({ ticket_deleted_at: null }).eq('id', applicationId));
    },

    async openTickets() {
      const rows = check(
        await db()
          .from('recruit_applications')
          .select('id')
          .is('closed_at', null)
          .is('ticket_closed_at', null)
          .is('ticket_deleted_at', null)
          .or('discord_channel_id.not.is.null,discord_thread_id.not.is.null')
          .order('id')
      ) as Array<{ id: number }>;
      return rows.map((r) => r.id);
    },

    async linkedDiscordIds(ids) {
      const rows = check(await db().from('people').select('discord_id').in('discord_id', ids)) as Array<{
        discord_id: string;
      }>;
      return new Set(rows.map((r) => r.discord_id));
    },

    async saveMade(applicationId, actor, made, detail) {
      // A fresh ticket after a reopen starts the closing steps over (#1544).
      check(
        await db()
          .from('recruit_applications')
          .update({
            ...made,
            ticket_closed_at: null,
            ticket_saved_at: null,
            ticket_deleted_at: null,
            ticket_save_failures: 0
          })
          .eq('id', applicationId)
      );
      check(
        await db()
          .from('recruit_events')
          .insert({ application_id: applicationId, kind: 'ticket_opened', actor_person_id: actor, detail })
      );
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, db: supabaseDb(), env: Deno.env };
}
