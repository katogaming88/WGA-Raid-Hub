import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { refusalStatus } from '../characters/useCharacters';
import { useDiscordServer, useDiscordSettings } from '../settings/useDiscordSettings';
import { channelName, roleName, type DiscordServer } from '../settings/discord';
import {
  CLOSE_NO_REPLY,
  DELETE_CLOSED,
  DM_REPLY,
  PING_OFFICERS,
  PING_OWNER,
  REMIND,
  TRIAL_NOTICE,
  withCurrent,
  type Choice,
  type DiscordMode,
  type Settings
} from './recruiting';
import type { Set } from './RecruitingSections';
import { useFindTicketChannel, useSetFindTicketChannel, useTicketViewers, type Viewer } from './useRecruiting';

// The Discord section of Recruiting settings (#1548): what the bot does when
// someone applies, where, who sees it, and when it nudges. The server's lists
// are read live from Discord (#994, #1541, #1814).

const MODES: { id: DiscordMode; title: string; note: string }[] = [
  {
    id: 'ticket',
    title: 'Private ticket with them and your officers',
    note: 'A channel just for them, opened with their application. It stays open through their trial.'
  },
  {
    id: 'officer_thread',
    title: 'Officer-only thread about them',
    note: "A thread in your officer channel to talk them over. They aren't in it; officers reach out to them directly."
  },
  {
    id: 'officer_post',
    title: 'Just post it in your officer channel',
    note: 'One message with their application and buttons. No new channel or thread.'
  },
  { id: 'none', title: 'Nothing in Discord', note: 'Applications only show up on Raid Hub, under Recruits.' }
];

function listOf(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function Timing({
  label,
  id,
  value,
  choices,
  unit,
  onChange
}: {
  label: string;
  id: string;
  value: number | null;
  choices: Choice[];
  unit: 'minutes' | 'hours';
  onChange: (v: number | null) => void;
}) {
  const all = withCurrent(choices, value, unit);
  return (
    <div className="field rec-timing">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="select"
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        {all.map((c) => (
          <option key={String(c.value)} value={c.value === null ? '' : String(c.value)}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DiscordSection({ teamId, s, set, base }: { teamId: number; s: Settings; set: Set; base: string }) {
  const server = useDiscordServer(teamId);
  const saved = useDiscordSettings(teamId);
  const viewers = useTicketViewers(teamId);
  const ticketTeam = s.discord_mode === 'ticket';
  const needsChannel =
    s.discord_mode === 'officer_thread' ||
    s.discord_mode === 'officer_post' ||
    (ticketTeam && s.officer_thread_with_ticket);
  const officerChannelId = saved.data?.posts.find((p) => p.kind === 'officer_requests')?.channel_id ?? null;
  const settingsLink = `${base}/officer/settings/discord`;

  return (
    <>
      <fieldset className="rec-radios">
        <legend className="field-label">When someone applies</legend>
        {MODES.map((m) => (
          <label key={m.id} className="rec-mode">
            <input
              type="radio"
              name="mode"
              checked={s.discord_mode === m.id}
              onChange={() => set('discord_mode', m.id)}
            />{' '}
            <b>{m.title}</b>
            <span className="text-dim rec-note"> {m.note}</span>
          </label>
        ))}
      </fieldset>
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.officer_thread_with_ticket && ticketTeam}
          disabled={!ticketTeam}
          onChange={(e) => set('officer_thread_with_ticket', e.target.checked)}
        />{' '}
        <b>Also open an officer-only thread</b>
        <span className="text-dim rec-note">
          {' '}
          With a private ticket, a separate place for officers to talk them over.
        </span>
      </label>
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.add_to_server || ticketTeam}
          disabled={ticketTeam}
          onChange={(e) => set('add_to_server', e.target.checked)}
        />{' '}
        <b>Add them to the Discord server when they apply</b>
        <span className="text-dim rec-note"> Needed for a private ticket. With the other choices it's up to you.</span>
      </label>

      <DataState query={server} label="your Discord server">
        {(read) => (
          <ServerPart
            teamId={teamId}
            s={s}
            set={set}
            server={read.server}
            serverId={saved.data?.server_id ?? null}
            settingsLink={settingsLink}
            ticketTeam={ticketTeam}
            needsChannel={needsChannel}
            officerChannelId={officerChannelId}
          />
        )}
      </DataState>

      <h3 className="rec-sub">Who can see tickets and officer threads</h3>
      <p className="text-dim rec-note">
        Only these people (plus the applicant, in a ticket) can see them, not every officer in the guild.
      </p>
      <DataState query={viewers} label="who sees tickets">
        {(list) => <Viewers s={s} set={set} list={list} server={server.data?.server ?? null} />}
      </DataState>

      <h3 className="rec-sub">When it's their turn to reply (private ticket only)</h3>
      <Timing
        label="DM them about a reply after"
        id="rec-dm"
        value={s.dm_reply_after_minutes}
        choices={DM_REPLY}
        unit="minutes"
        onChange={(v) => set('dm_reply_after_minutes', v)}
      />
      <Timing
        label="Remind them after"
        id="rec-remind"
        value={s.remind_after_hours}
        choices={REMIND}
        unit="hours"
        onChange={(v) => set('remind_after_hours', v)}
      />
      <Timing
        label={'Close as "No reply" after'}
        id="rec-close"
        value={s.close_no_reply_after_hours}
        choices={CLOSE_NO_REPLY}
        unit="hours"
        onChange={(v) => set('close_no_reply_after_hours', v)}
      />
      <p className="text-dim rec-note">One DM per reply. No DMs between 1 and 9 AM their time.</p>

      <h3 className="rec-sub">When it's your turn to reply</h3>
      <Timing
        label="Ping the officer channel after"
        id="rec-ping1"
        value={s.ping_officers_after_hours}
        choices={PING_OFFICERS}
        unit="hours"
        onChange={(v) => set('ping_officers_after_hours', v)}
      />
      <Timing
        label="Then ping the Team Owner after"
        id="rec-ping2"
        value={s.ping_owner_after_hours}
        choices={PING_OWNER}
        unit="hours"
        onChange={(v) => set('ping_owner_after_hours', v)}
      />

      <h3 className="rec-sub">Trials and closed tickets</h3>
      <Timing
        label="Heads-up before a trial ends"
        id="rec-notice"
        value={s.trial_end_notice_hours}
        choices={TRIAL_NOTICE}
        unit="hours"
        onChange={(v) => set('trial_end_notice_hours', v)}
      />
      <Timing
        label="Delete closed tickets after"
        id="rec-delete"
        value={s.delete_closed_after_hours}
        choices={DELETE_CLOSED}
        unit="hours"
        onChange={(v) => set('delete_closed_after_hours', v)}
      />
      <p className="text-dim rec-note">
        With a private ticket, it stays open for the whole trial. Extend trial adds another trial length and asks for a
        reason. Closed tickets are saved to Raid Hub before they're deleted.
      </p>
    </>
  );
}

// The parts that need the server's own lists. Reading them is for officers who
// can change the team's Discord settings; anyone else gets the database's
// refusal, said plainly, and can still change everything else on this page.
function ServerPart({
  teamId,
  s,
  set,
  server,
  serverId,
  settingsLink,
  ticketTeam,
  needsChannel,
  officerChannelId
}: {
  teamId: number;
  s: Settings;
  set: Set;
  server: DiscordServer | null;
  serverId: string | null;
  settingsLink: string;
  ticketTeam: boolean;
  needsChannel: boolean;
  officerChannelId: string | null;
}) {
  if (!server || !serverId) {
    return (
      <p className="apply-note">
        {"Pick this team's Discord server first, in "}
        <Link to={settingsLink}>Settings, Discord</Link>
        {'. Tickets and officer threads need it.'}
      </p>
    );
  }
  if (!server.botIn) {
    return (
      <p className="apply-note">
        The WGA Raid Hub bot isn't in {server.name ?? 'that server'} yet. Add it from{' '}
        <Link to={settingsLink}>Settings, Discord</Link>.
      </p>
    );
  }
  const category = server.categories.find((c) => c.id === s.ticket_category_id) ?? null;
  const channel = officerChannelId ? channelName(server, officerChannelId) : null;
  return (
    <>
      {ticketTeam && (
        <div className="field">
          <label className="field-label" htmlFor="rec-category">
            Open tickets in
          </label>
          <select
            id="rec-category"
            className="select"
            value={s.ticket_category_id ?? ''}
            onChange={(e) => set('ticket_category_id', e.target.value || null)}
          >
            <option value="">Pick a category</option>
            {server.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.missing.length ? ' (the bot is missing permissions here)' : ''}
              </option>
            ))}
          </select>
          {s.ticket_category_id && !category && (
            <p className="form-error">That category no longer exists in the server. Pick another.</p>
          )}
          {category && category.missing.length > 0 && (
            <p className="apply-note" role="status">
              The bot can't make ticket channels in {category.name} yet. In Discord, open the category's settings, then
              Permissions, add the WGA Raid Hub role, and turn on{' '}
              {listOf(category.missing.filter((m) => !m.startsWith('Manage Roles')))}
              {category.missing.some((m) => m.startsWith('Manage Roles')) &&
                `${category.missing.length > 1 ? '; and ' : ''}give the WGA Raid Hub role Manage Roles under Server Settings, Roles`}
              .
            </p>
          )}
          <p className="text-dim rec-note">
            Tickets get the category of {server.name ?? 'your server'}'s that you pick.
          </p>
        </div>
      )}
      {ticketTeam && <FindTicket teamId={teamId} server={server} settingsLink={settingsLink} />}
      {needsChannel && (
        <div className="field">
          <span className="field-label">Officer channel</span>
          <p>{channel ?? <span className="text-dim">Not set</span>}</p>
          <p className="text-dim rec-note">
            Change it in <Link to={settingsLink}>Settings, Discord</Link>. Use an officer channel only this team's
            people can see: anyone with Manage Threads there sees every private thread in it, so two teams sharing one
            channel see each other's applicants.
          </p>
        </div>
      )}
    </>
  );
}

// Find my ticket (#1542): one message per server, with a button that shows
// each applicant a link to their own open tickets. Posted at once, so it is its
// own control and not part of Save.
function FindTicket({ teamId, server, settingsLink }: { teamId: number; server: DiscordServer; settingsLink: string }) {
  const current = useFindTicketChannel(teamId, true);
  const set = useSetFindTicketChannel(teamId);
  const { announce } = useStatus();
  const pick = (channelId: string | null) =>
    set.mutate(channelId, {
      onSuccess: () => announce('success', channelId ? 'Find my ticket posted.' : 'Find my ticket removed.'),
      onError: (e) => announce('error', errorMessage(e))
    });
  return (
    <div className="field">
      <label className="field-label" htmlFor="rec-find">
        Find my ticket channel
      </label>
      <DataState query={current} label="Find my ticket">
        {(value) => (
          <select
            id="rec-find"
            className="select"
            value={value.channelId ?? ''}
            disabled={set.isPending}
            onChange={(e) => pick(e.target.value || null)}
          >
            <option value="">Not posted</option>
            {server.channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        )}
      </DataState>
      <p className="text-dim rec-note">
        The bot posts one message with a Find my ticket button, so an applicant who loses their ticket can find it
        again. One per Discord server, shared by its teams. Pick a channel everyone can read.{' '}
        <Link to={settingsLink}>Bot permissions</Link>
      </p>
      {refusalStatus(set.error) === 403 && <p className="form-error">Only the guild that set this can change it.</p>}
    </div>
  );
}

function Viewers({ s, set, list, server }: { s: Settings; set: Set; list: Viewer[]; server: DiscordServer | null }) {
  const count = (group: Viewer['viewer_group']) => list.filter((v) => v.viewer_group === group).length;
  const unlinked = list.filter((v) => !v.discord_linked);
  const roles = server?.roles ?? [];
  const addable = roles.filter((r) => !s.visible_to_role_ids.includes(r.id));
  return (
    <>
      <p className="text-dim rec-note">From Raid Hub</p>
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.visible_to_team_officers}
          onChange={(e) => set('visible_to_team_officers', e.target.checked)}
        />{' '}
        The team's officers (Team Owner and Officers)
        {s.visible_to_team_officers ? `, ${count('officer')} ${count('officer') === 1 ? 'person' : 'people'}` : ''}
      </label>
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.visible_to_team_assistants}
          onChange={(e) => set('visible_to_team_assistants', e.target.checked)}
        />{' '}
        The team's assistants
        {s.visible_to_team_assistants
          ? `, ${count('assistant')} ${count('assistant') === 1 ? 'person' : 'people'}`
          : ''}
      </label>
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.visible_to_guild_admins}
          onChange={(e) => set('visible_to_guild_admins', e.target.checked)}
        />{' '}
        The guild's Owner and Admins
      </label>
      <p className="text-dim rec-note">
        The bot adds each person by their linked Discord account and keeps it in step with the roster: promote someone
        on Raid Hub and they're added to open tickets too; demote them or they leave the team and they're removed.
      </p>
      {unlinked.length > 0 && (
        <p className="apply-note" role="status">
          {unlinked.length === 1
            ? `${unlinked[0]!.display_name} hasn't`
            : `${listOf(unlinked.map((u) => u.display_name))} haven't`}{' '}
          linked Discord yet and won't be added until {unlinked.length === 1 ? 'they do' : 'they do'}.
        </p>
      )}
      <div className="field">
        <span className="field-label">Also these Discord roles (optional)</span>
        {s.visible_to_role_ids.length > 0 && (
          <ul className="rec-chips">
            {s.visible_to_role_ids.map((id) => {
              const name = server ? roleName(server, id) : null;
              return (
                <li key={id}>
                  {name ?? 'A role that no longer exists'}{' '}
                  <button
                    type="button"
                    className="rec-link"
                    aria-label={`Remove ${name ?? 'this role'}`}
                    onClick={() =>
                      set(
                        'visible_to_role_ids',
                        s.visible_to_role_ids.filter((r) => r !== id)
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {server && (
          <div className="rec-inline">
            <label className="visually-hidden" htmlFor="rec-role">
              Add a role
            </label>
            <select
              id="rec-role"
              className="select"
              value=""
              disabled={addable.length === 0 || s.visible_to_role_ids.length >= 25}
              onChange={(e) => e.target.value && set('visible_to_role_ids', [...s.visible_to_role_ids, e.target.value])}
            >
              <option value="">+ Add a role</option>
              {addable.map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="field-hint">
          For people who aren't officers on Raid Hub, like recruiters. Roles are read live from your Discord server.
        </span>
      </div>
    </>
  );
}
