import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { DISCORD, useSession } from '../auth/session';
import { errorMessage } from '../lib/errors';
import { timeAgoLabel } from '../profile/profile';
import {
  BOT_INSTALL_URL,
  DAY_ORDER,
  DAY_SHORT,
  POST_KINDS,
  QUIET_ZONES,
  channelName,
  channelProblem,
  daysLabel,
  postSummary,
  roleProblem,
  sheetTiming,
  takenDays,
  type DiscordPost,
  type DiscordRead,
  type DiscordServer,
  type DiscordSettings,
  type PostKind,
  type SignupSheet
} from './discord';
import {
  useDiscordServer,
  useDiscordSettings,
  useRemoveSignupSheet,
  useSaveSignupSheet,
  useSendTestMessage,
  useSetDiscordPost,
  useSetDiscordServer,
  useSetQuietHours
} from './useDiscordSettings';
import '../characters/characters.css';
import './settings.css';

// Settings › Discord (#994): where the bot posts for this team and whom it
// pings, picked from lists read live from Discord. No id is ever typed.
// Each dialog saves on its own, so the page has no Save bar.
export function DiscordSettingsPage() {
  const team = useTeam();
  const settings = useDiscordSettings(team.id);
  const discord = useDiscordServer(team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Discord settings</h1>
      </div>
      <p className="text-muted">
        What the bot posts in your Discord for this team, where, and who it pings. New to this?{' '}
        <Link to="/help/discord-setup">Set up Discord for your team</Link>.{' '}
        {/* Until the site posts by itself (#959, #960). Delete with #959. */}
        The bot starts posting with these settings in an upcoming update. Send test message works now.
      </p>
      <DataState query={bothQueries(settings, discord)} label="your Discord settings">
        {([saved, read]) => (
          <DiscordBody
            teamId={team.id}
            saved={saved}
            read={read}
            checkedAt={discord.dataUpdatedAt}
            onCheck={() => void discord.refetch()}
            checking={discord.isFetching}
          />
        )}
      </DataState>
    </section>
  );
}

function DiscordBody({
  teamId,
  saved,
  read,
  checkedAt,
  onCheck,
  checking
}: {
  teamId: number;
  saved: DiscordSettings;
  read: DiscordRead;
  checkedAt: number;
  onCheck: () => void;
  checking: boolean;
}) {
  if (!saved.server_id || !read.server) {
    return <FirstServer teamId={teamId} read={read} onCheck={onCheck} checking={checking} />;
  }
  const server = read.server;
  return (
    <div className="settings-cards">
      <ServerCard
        teamId={teamId}
        server={server}
        read={read}
        checkedAt={checkedAt}
        onCheck={onCheck}
        checking={checking}
      />
      {server.botIn && (
        <>
          <PostsCard teamId={teamId} posts={saved.posts} server={server} />
          <SheetsCard teamId={teamId} sheets={saved.sheets} server={server} />
          <QuietHoursCard teamId={teamId} saved={saved.quiet_hours} />
        </>
      )}
    </div>
  );
}

// No server yet: connect Discord, add the bot, or pick one of the servers
// the officer and the bot share.
function FirstServer({
  teamId,
  read,
  onCheck,
  checking
}: {
  teamId: number;
  read: DiscordRead;
  onCheck: () => void;
  checking: boolean;
}) {
  const { connect } = useSession();
  if (!read.hasDiscord) {
    return (
      <section className="card settings-card discord-card">
        <h2>Connect Discord first</h2>
        <p className="text-muted">
          The page lists the Discord servers you’re in, so it needs your Discord. Connect it, then come back.
        </p>
        <button type="button" className="button button-primary" onClick={() => void connect(DISCORD)}>
          Connect Discord
        </button>
      </section>
    );
  }
  if (read.servers.length === 0) {
    return (
      <section className="card settings-card discord-card">
        <h2>Add the bot to your server</h2>
        <p className="text-muted">
          The WGA Raid Hub bot isn’t in any Discord server you’re in yet. Add it to your guild’s server, then come back
          to choose what it posts. You need Manage Server in that server to add it.
        </p>
        <AddBot onCheck={onCheck} checking={checking} />
      </section>
    );
  }
  return (
    <section className="card settings-card discord-card">
      <h2>Pick your team’s server</h2>
      <p className="text-muted">The Discord servers you and the bot are both in.</p>
      <ServerPicker teamId={teamId} servers={read.servers} />
      <p className="text-muted">
        Not listed?{' '}
        <a href={BOT_INSTALL_URL} target="_blank" rel="noreferrer">
          Add the bot to it
        </a>
        , then{' '}
        <button type="button" className="link-button" onClick={onCheck} disabled={checking}>
          check again
        </button>
        .
      </p>
    </section>
  );
}

function AddBot({ onCheck, checking }: { onCheck: () => void; checking: boolean }) {
  return (
    <div className="settings-row">
      <a className="button button-primary" href={BOT_INSTALL_URL} target="_blank" rel="noreferrer">
        Add WGA Raid Hub to Discord
      </a>
      <button type="button" className="button" onClick={onCheck} disabled={checking}>
        {checking ? 'Checking…' : 'I’ve added it'}
      </button>
    </div>
  );
}

function ServerPicker({
  teamId,
  servers,
  warn = false,
  onDone
}: {
  teamId: number;
  servers: { id: string; name: string }[];
  warn?: boolean;
  onDone?: () => void;
}) {
  const { announce } = useStatus();
  const id = useId();
  const [serverId, setServerId] = useState(servers[0]?.id ?? '');
  const save = useSetDiscordServer(teamId);
  const onSave = () =>
    save.mutate(serverId, {
      onSuccess: () => {
        announce('success', 'Saved.');
        onDone?.();
      },
      onError: (error) => announce('error', errorMessage(error))
    });
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={id}>
          Discord server
        </label>
        <select id={id} className="select" value={serverId} onChange={(e) => setServerId(e.target.value)}>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {warn && (
          <p className="field-hint">
            Changing the server turns off every kind of post and removes the signup sheets, since their channels belong
            to the old server.
          </p>
        )}
      </div>
      <div className="dialog-actions">
        {onDone && (
          <button type="button" className="button" onClick={onDone} disabled={save.isPending}>
            Cancel
          </button>
        )}
        <button type="button" className="button button-primary" onClick={onSave} disabled={!serverId || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );
}

function ServerCard({
  teamId,
  server,
  read,
  checkedAt,
  onCheck,
  checking
}: {
  teamId: number;
  server: DiscordServer;
  read: DiscordRead;
  checkedAt: number;
  onCheck: () => void;
  checking: boolean;
}) {
  const [changing, setChanging] = useState(false);
  const others = read.servers.filter((s) => s.id !== server.id);
  return (
    <section className="card settings-card discord-card">
      <h2>Server</h2>
      <dl className="discord-facts">
        <dt>Discord server</dt>
        <dd>
          <strong>{server.name ?? 'A server the bot has left'}</strong>
        </dd>
        <dt>The bot</dt>
        <dd className={server.botIn ? 'discord-good' : 'discord-problem'}>
          {server.botIn ? 'In the server' : 'Not in this server any more. Nothing posts until it is added back.'}
        </dd>
        <dt>Checked</dt>
        <dd>{timeAgoLabel(new Date(checkedAt).toISOString()) || 'just now'}</dd>
      </dl>
      {!server.botIn && <AddBot onCheck={onCheck} checking={checking} />}
      <div className="discord-card-foot">
        <p className="text-muted">Removing the bot from the server stops every post for every team there.</p>
        <button type="button" className="button" onClick={() => setChanging(true)}>
          Change server
        </button>
      </div>
      {changing && (
        <Dialog title="Change server" onClose={() => setChanging(false)}>
          {others.length > 0 ? (
            <ServerPicker teamId={teamId} servers={others} warn onDone={() => setChanging(false)} />
          ) : (
            <>
              <p>
                The bot isn’t in any other server you’re in.{' '}
                <a href={BOT_INSTALL_URL} target="_blank" rel="noreferrer">
                  Add it to one
                </a>
                , then open this page again.
              </p>
              <div className="dialog-actions">
                <button type="button" className="button" onClick={() => setChanging(false)}>
                  Close
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </section>
  );
}

function PostsCard({ teamId, posts, server }: { teamId: number; posts: DiscordPost[]; server: DiscordServer }) {
  const [open, setOpen] = useState<PostKind | null>(null);
  const byKind = new Map(posts.map((p) => [p.kind, p]));
  const openKind = POST_KINDS.find((k) => k.kind === open);
  return (
    <section className="card settings-card discord-card">
      <h2>What the bot posts</h2>
      <p className="text-muted">Choose one to pick its channel and who it pings.</p>
      <ul className="discord-rows">
        {POST_KINDS.map((k) => {
          const post = byKind.get(k.kind);
          const summary = postSummary(server, {
            channel_id: post?.channel_id ?? null,
            ping_role_id: post?.ping_role_id ?? null
          });
          return (
            <li key={k.kind}>
              <button type="button" className="discord-row" onClick={() => setOpen(k.kind)}>
                <span className="discord-row-main">
                  <span className="discord-row-title">{k.label}</span>
                  <span className="text-muted">{k.description}</span>
                </span>
                <span className="discord-row-side">
                  <span className={summary.problem ? 'discord-problem' : undefined}>{summary.text}</span>
                  {post?.last_posted_at && (
                    <span className="text-muted">Last posted {timeAgoLabel(post.last_posted_at)}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {openKind && (
        <PostDialog
          teamId={teamId}
          kind={openKind}
          post={byKind.get(openKind.kind) ?? null}
          server={server}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function PostDialog({
  teamId,
  kind,
  post,
  server,
  onClose
}: {
  teamId: number;
  kind: (typeof POST_KINDS)[number];
  post: DiscordPost | null;
  server: DiscordServer;
  onClose: () => void;
}) {
  const { announce } = useStatus();
  const [channelId, setChannelId] = useState(post?.channel_id ?? '');
  const [roleId, setRoleId] = useState(post?.ping_role_id ?? '');
  const save = useSetDiscordPost(teamId);
  const isOn = Boolean(post?.channel_id);

  const write = (channel: string | null, role: string | null, done: string) =>
    save.mutate(
      { kind: kind.kind, channelId: channel, roleId: role },
      {
        onSuccess: () => {
          announce('success', done);
          onClose();
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );

  return (
    <Dialog title={kind.label} onClose={onClose} busy={save.isPending}>
      <p className="text-muted">{kind.dialog}</p>
      <ChannelField server={server} value={channelId} onChange={setChannelId} saved={post?.channel_id ?? null} />
      <RoleField
        server={server}
        value={roleId}
        onChange={setRoleId}
        saved={post?.ping_role_id ?? null}
        hint="The role to ping with each post."
      />
      <TestMessage teamId={teamId} server={server} channelId={channelId} kind={kind.kind} />
      <div className="dialog-actions discord-actions">
        {isOn && (
          <button
            type="button"
            className="button discord-actions-start"
            onClick={() => write(null, null, 'Turned off.')}
            disabled={save.isPending}
          >
            Turn off
          </button>
        )}
        <button type="button" className="button" onClick={onClose} disabled={save.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => write(channelId, roleId || null, isOn ? 'Saved.' : 'Turned on.')}
          disabled={!channelId || save.isPending}
        >
          {save.isPending ? 'Saving…' : isOn ? 'Save' : 'Turn on'}
        </button>
      </div>
    </Dialog>
  );
}

function ChannelField({
  server,
  value,
  onChange,
  saved
}: {
  server: DiscordServer;
  value: string;
  onChange: (id: string) => void;
  saved: string | null;
}) {
  const id = useId();
  const problem = value ? channelProblem(server, value) : null;
  const categories = [...new Set(server.channels.map((c) => c.category))];
  const gone = saved && !server.channels.some((c) => c.id === saved);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Channel
      </label>
      <select
        id={id}
        className="select"
        value={value}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Pick a channel</option>
        {gone && <option value={saved}>A deleted channel</option>}
        {categories.map((category) => {
          const options = server.channels
            .filter((c) => c.category === category)
            .map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ));
          return category ? (
            <optgroup key={category} label={category}>
              {options}
            </optgroup>
          ) : (
            options
          );
        })}
      </select>
      {problem && (
        <p id={`${id}-problem`} className="field-hint discord-problem">
          {problem}
        </p>
      )}
    </div>
  );
}

function RoleField({
  server,
  value,
  onChange,
  saved,
  hint
}: {
  server: DiscordServer;
  value: string;
  onChange: (id: string) => void;
  saved: string | null;
  hint: string;
}) {
  const id = useId();
  const problem = value ? roleProblem(server, value) : null;
  const gone = saved && !server.roles.some((r) => r.id === saved);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Ping
      </label>
      <select
        id={id}
        className="select"
        value={value}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No ping</option>
        {gone && <option value={saved}>A deleted role</option>}
        {server.roles.map((r) => (
          <option key={r.id} value={r.id}>
            @{r.name}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className={problem ? 'field-hint discord-problem' : 'field-hint'}>
        {problem ?? `Optional. ${hint}`}
      </p>
    </div>
  );
}

function TestMessage({
  teamId,
  server,
  channelId,
  kind
}: {
  teamId: number;
  server: DiscordServer;
  channelId: string;
  kind: PostKind | 'signup_sheet';
}) {
  const send = useSendTestMessage(teamId);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const usable = Boolean(channelId) && !channelProblem(server, channelId);
  const onSend = () => {
    setResult(null);
    send.mutate(
      { channelId, kind },
      {
        onSuccess: () => setResult({ ok: true, text: `Test message sent. Check ${channelName(server, channelId)}.` }),
        onError: (error) => setResult({ ok: false, text: errorMessage(error) })
      }
    );
  };
  return (
    <div className="settings-row discord-test">
      <button type="button" className="button" onClick={onSend} disabled={!usable || send.isPending}>
        {send.isPending ? 'Sending…' : 'Send test message'}
      </button>
      <span role="status" className={result?.ok ? 'discord-good' : 'discord-problem'}>
        {result?.text}
      </span>
    </div>
  );
}

function SheetsCard({ teamId, sheets, server }: { teamId: number; sheets: SignupSheet[]; server: DiscordServer }) {
  const [open, setOpen] = useState<SignupSheet | 'new' | null>(null);
  const allTaken = DAY_ORDER.every((d) => takenDays(sheets, null).has(d));
  return (
    <section className="card settings-card discord-card">
      <h2>Signup sheets</h2>
      <p className="text-muted">
        One post per raid night with everyone’s RSVP, kept up to date. Give some raid days their own channel by adding a
        sheet for them.
      </p>
      {sheets.length > 0 && (
        <ul className="discord-rows">
          {sheets.map((sheet) => {
            const name = channelName(server, sheet.channel_id);
            const problem = channelProblem(server, sheet.channel_id);
            return (
              <li key={sheet.id}>
                <button type="button" className="discord-row" onClick={() => setOpen(sheet)}>
                  <span className="discord-row-main">
                    <span className="discord-row-title">{name ?? 'A deleted channel'}</span>
                    <span className="text-muted">{daysLabel(sheet.raid_days)}</span>
                  </span>
                  <span className="discord-row-side">
                    {problem ? (
                      <span className="discord-problem">
                        {name ? `The bot can't post in ${name}` : 'Its channel no longer exists'}
                      </span>
                    ) : (
                      <span>{sheetTiming(sheet)}</span>
                    )}
                    {sheet.last_posted_at && (
                      <span className="text-muted">Last posted {timeAgoLabel(sheet.last_posted_at)}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <button type="button" className="button" onClick={() => setOpen('new')} disabled={allTaken}>
          Add a signup sheet
        </button>
      </div>
      {open && (
        <SheetDialog
          teamId={teamId}
          sheet={open === 'new' ? null : open}
          sheets={sheets}
          server={server}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function SheetDialog({
  teamId,
  sheet,
  sheets,
  server,
  onClose
}: {
  teamId: number;
  sheet: SignupSheet | null;
  sheets: SignupSheet[];
  server: DiscordServer;
  onClose: () => void;
}) {
  const { announce } = useStatus();
  const hoursId = useId();
  const keepId = useId();
  const [channelId, setChannelId] = useState(sheet?.channel_id ?? '');
  const [days, setDays] = useState<number[]>(sheet?.raid_days ?? []);
  const [byHours, setByHours] = useState(sheet?.hours_before != null);
  const [keep, setKeep] = useState(sheet?.keep_raids_posted ?? 2);
  const [hours, setHours] = useState(String(sheet?.hours_before ?? 48));
  const [roleId, setRoleId] = useState(sheet?.ping_role_id ?? '');
  const save = useSaveSignupSheet(teamId);
  const remove = useRemoveSignupSheet(teamId);
  const busy = save.isPending || remove.isPending;

  const taken = takenDays(sheets, sheet?.id ?? null);
  // "Thursday and Sunday are on #thursday-raids."
  const takenNotes = [...new Set(taken.values())].map((channel) => {
    const list = DAY_ORDER.filter((d) => taken.get(d) === channel);
    const names = daysLabel(list, false);
    return `${names} ${list.length > 1 ? 'are' : 'is'} on ${channelName(server, channel) ?? 'another sheet'}.`;
  });
  const hoursNumber = Math.round(Number(hours));
  const hoursOk = Number.isFinite(hoursNumber) && hoursNumber >= 1 && hoursNumber <= 168;

  const done = (text: string) => ({
    onSuccess: () => {
      announce('success', text);
      onClose();
    },
    onError: (error: Error) => announce('error', errorMessage(error))
  });
  const onSave = () =>
    save.mutate(
      {
        id: sheet?.id ?? null,
        channelId,
        days,
        keep: byHours ? null : keep,
        hours: byHours ? hoursNumber : null,
        roleId: roleId || null
      },
      done('Saved.')
    );
  const toggle = (day: number) => setDays((now) => (now.includes(day) ? now.filter((d) => d !== day) : [...now, day]));

  return (
    <Dialog title="Signup sheet" onClose={onClose} busy={busy}>
      <p className="text-muted">One post per raid night with everyone’s RSVP, updated as people answer.</p>
      <ChannelField server={server} value={channelId} onChange={setChannelId} saved={sheet?.channel_id ?? null} />
      <fieldset className="field discord-fieldset">
        <legend className="field-label">Raid days</legend>
        <div className="picker-choice discord-days">
          {DAY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              className="picker-choice-option"
              aria-pressed={days.includes(d)}
              disabled={taken.has(d)}
              onClick={() => toggle(d)}
            >
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
        {takenNotes.length > 0 && <p className="field-hint">{takenNotes.join(' ')} A day can be on one sheet only.</p>}
      </fieldset>
      <fieldset className="field discord-fieldset">
        <legend className="field-label">When to post</legend>
        <div className="picker-choice">
          <button
            type="button"
            className="picker-choice-option"
            aria-pressed={!byHours}
            onClick={() => setByHours(false)}
          >
            Keep raids posted
          </button>
          <button
            type="button"
            className="picker-choice-option"
            aria-pressed={byHours}
            onClick={() => setByHours(true)}
          >
            Hours before each raid
          </button>
        </div>
        {byHours ? (
          <div className="settings-row">
            <input
              id={hoursId}
              type="number"
              className="input settings-number"
              min={1}
              max={168}
              value={hours}
              aria-invalid={hoursOk ? undefined : true}
              onChange={(e) => setHours(e.target.value)}
            />
            <label htmlFor={hoursId}>hours before each raid</label>
          </div>
        ) : (
          <div className="settings-row">
            <select
              id={keepId}
              className="select discord-keep"
              value={keep}
              onChange={(e) => setKeep(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 raid' : `${n} raids`}
                </option>
              ))}
            </select>
            <label htmlFor={keepId}>posted at a time</label>
          </div>
        )}
        <p className="field-hint">
          {byHours
            ? 'Each raid gets its sheet this many hours before it starts, up to a week (168).'
            : 'The next raids are always posted; when one passes, the next one goes up.'}
        </p>
      </fieldset>
      <RoleField
        server={server}
        value={roleId}
        onChange={setRoleId}
        saved={sheet?.ping_role_id ?? null}
        hint="The role to ping when a new raid goes up."
      />
      <TestMessage teamId={teamId} server={server} channelId={channelId} kind="signup_sheet" />
      <div className="dialog-actions discord-actions">
        {sheet && (
          <button
            type="button"
            className="button discord-actions-start"
            onClick={() => remove.mutate(sheet.id, done('Sheet removed.'))}
            disabled={busy}
          >
            Remove sheet
          </button>
        )}
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={onSave}
          disabled={!channelId || days.length === 0 || (byHours && !hoursOk) || busy}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

// "HH:MM:SS" from the database, "HH:MM" for a time input.
const hhmm = (time: string | undefined, fallback: string) => (time ? time.slice(0, 5) : fallback);

function QuietHoursCard({ teamId, saved }: { teamId: number; saved: DiscordSettings['quiet_hours'] }) {
  const { announce } = useStatus();
  const startId = useId();
  const endId = useId();
  const zoneId = useId();
  const [on, setOn] = useState(saved !== null);
  const [start, setStart] = useState(hhmm(saved?.start, '00:00'));
  const [end, setEnd] = useState(hhmm(saved?.end, '08:00'));
  const [zone, setZone] = useState(saved?.timezone ?? QUIET_ZONES[0]!.id);
  const save = useSetQuietHours(teamId);
  const zones = QUIET_ZONES.some((z) => z.id === zone) ? QUIET_ZONES : [...QUIET_ZONES, { id: zone, label: zone }];

  const onSave = () =>
    save.mutate(on ? { start, end, timezone: zone } : null, {
      onSuccess: () => announce('success', on ? 'Saved.' : 'Quiet hours off.'),
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <section className="card settings-card discord-card">
      <h2>Quiet hours</h2>
      <p className="text-muted">
        The bot posts nothing during quiet hours. Anything that comes up waits and posts when quiet hours end.
      </p>
      <div className="settings-row">
        <div className="picker-choice" role="group" aria-label="Quiet hours">
          <button type="button" className="picker-choice-option" aria-pressed={!on} onClick={() => setOn(false)}>
            Off
          </button>
          <button type="button" className="picker-choice-option" aria-pressed={on} onClick={() => setOn(true)}>
            On
          </button>
        </div>
        {on && (
          <>
            <label className="visually-hidden" htmlFor={startId}>
              Quiet hours start
            </label>
            <input
              id={startId}
              type="time"
              className="input discord-time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <span>to</span>
            <label className="visually-hidden" htmlFor={endId}>
              Quiet hours end
            </label>
            <input
              id={endId}
              type="time"
              className="input discord-time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <label className="visually-hidden" htmlFor={zoneId}>
              Time zone
            </label>
            <select id={zoneId} className="select" value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          className="button button-primary discord-quiet-save"
          onClick={onSave}
          disabled={(on && (!start || !end || start === end)) || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
