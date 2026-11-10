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
  // service role's, scoped here to the caller's own open application.
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
      const person = check(
        await db().from('people').select('id, discord_id').eq('auth_user_id', authUserId).maybeSingle()
      );
      if (!person) return null;
      const app = check(
        await db()
          .from('recruit_applications')
          .select(
            'id, team_id, person_id, character_id, name_realm, class_name, spec_name, other_specs, item_level,' +
              ' mplus_score, logs_best_average, mythic_bosses_killed, answers, sent_by, sent_by_name,' +
              ' discord_channel_id, discord_thread_id, discord_officer_message_id'
          )
          .eq('id', applicationId)
          .eq('person_id', person.id)
          .is('closed_at', null)
          .maybeSingle()
      ) as any;
      if (!app) return null;

      const [team, recruiting, discord, character, before] = await Promise.all([
        db().from('teams').select('name, slug, guild_id').eq('id', app.team_id).single().then(check),
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
        db()
          .from('recruit_applications')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', app.team_id)
          .eq('person_id', person.id)
          .neq('id', app.id)
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
        applied_before: (before.count ?? 0) > 0,
        discord_channel_id: app.discord_channel_id,
        discord_thread_id: app.discord_thread_id,
        discord_officer_message_id: app.discord_officer_message_id,
        mode: (r?.discord_mode ?? 'none') as Mode,
        thread_with_ticket: r?.officer_thread_with_ticket === true,
        server_id: (discord as any)?.guild_id ?? null,
        officer_channel_id: (discord as any)?.officer_channel_id ?? null,
        ticket_category_id: r?.ticket_category_id ?? null,
        role_ids: r?.visible_to_role_ids ?? [],
        viewer_ids: viewers
      } satisfies Ticket;
    },

    async saveMade(applicationId, actor, made, detail) {
      check(await db().from('recruit_applications').update(made).eq('id', applicationId));
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
