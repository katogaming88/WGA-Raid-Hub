import { useId, useMemo } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { can, teamRole, useAccess, type Access } from '../auth/access';
import { useAddress, useGuildDetails } from '../data/address';
import { useGuildStreamers } from '../streams/StreamWidget';
import { embedParent, embedSrc } from '../streams/streams';
import { classColor } from '../roster/roster';
import { newsShortDate, sortNews } from '../news/news';
import { useNews } from '../news/useNews';
import {
  attentionRows,
  guildIntro,
  guildLinks,
  guildLive,
  officers,
  teamCards,
  type GuildStream,
  type Officer,
  type TeamCard,
  type TeamInput
} from './guild';
import { useAttention, useGuildOfficers, useTeamCardData } from './useGuildHome';
import './guild.css';

// Guild home (#1102): the teams first, then who is live, with the officers'
// waiting work, the latest news and the guild officers beside them (Kat,
// 2026-09-17, option B). Checked against the current site's guild.html in
// tests/browser-app/guild.test.js.
export function GuildHomePage() {
  const { guild, teams } = useAddress();
  const details = useGuildDetails(guild.id);
  const listed = teams.filter((t) => !t.archived);
  const realm = details.data?.realm ?? null;
  const links = details.data ? guildLinks({ name: guild.name, ...details.data }) : null;

  return (
    <section className="page guild-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">{guild.name}</h1>
        <p className="text-muted page-subtitle">{guildIntro(listed.length, realm)}</p>
      </div>

      <div className="guild-grid">
        <div className="guild-main">
          <Teams teams={listed} />
          <LiveNow teams={listed} />
          {links && (
            <ul className="guild-links" aria-label="Guild links">
              <li>
                <a href={links.raiderIo} target="_blank" rel="noopener">
                  Raider.IO
                </a>
              </li>
              <li>
                <a href={links.armory} target="_blank" rel="noopener">
                  Armory
                </a>
              </li>
            </ul>
          )}
        </div>
        <aside className="guild-side" aria-label="Guild updates">
          <Attention teams={listed} />
          <News />
          <Officers />
        </aside>
      </div>
    </section>
  );
}

// The teams the reader has a current character on.
const myTeams = (access: Access | undefined) =>
  new Set((access?.teams ?? []).filter((t) => t.characters.length > 0).map((t) => t.teamId));

function Teams({ teams }: { teams: TeamInput[] }) {
  const ids = useMemo(() => teams.map((t) => t.id), [teams]);
  const today = useMemo(() => new Date(), []);
  const data = useTeamCardData(ids, today);
  const access = useAccess();

  return (
    <DataState query={data} label="the teams">
      {(rows) => (
        <ul className="guild-teams" aria-label="Teams">
          {teamCards(teams, rows, myTeams(access.data), today).map((card) => (
            <li key={card.id}>
              <TeamCardView card={card} />
            </li>
          ))}
        </ul>
      )}
    </DataState>
  );
}

function TeamCardView({ card }: { card: TeamCard }) {
  const { guild } = useAddress();
  const titleId = useId();
  const base = `/g/${guild.key}/t/${card.key}`;
  const { progress } = card;
  const raiders = `${card.raiders} ${card.raiders === 1 ? 'raider' : 'raiders'}`;

  return (
    <article className="card guild-team" aria-labelledby={titleId}>
      <div className="guild-team-body">
        <div className="guild-team-head">
          <h2 id={titleId} className="guild-team-name">
            {card.name}
          </h2>
          {card.mine && <span className="guild-tag guild-tag-mine">Your team</span>}
          {card.signup && <span className="guild-tag guild-tag-recruiting">Recruiting</span>}
        </div>
        <p className="guild-team-schedule text-muted">
          {card.schedule}
          {card.next && ` · next raid ${card.next}`}
        </p>
        {progress && (
          // The line under the pips says the same in words.
          <ol className="guild-pips" aria-hidden="true">
            {progress.pips.map((pip, i) => (
              <li key={i} className={`guild-pip guild-pip-${pip.kill}`} title={pip.name} />
            ))}
          </ol>
        )}
        <p className="guild-team-progress">
          {progress && <strong>{progress.text}</strong>}
          {progress && <span className="text-dim"> · </span>}
          <span className="text-dim">{raiders}</span>
        </p>
      </div>
      <div className="guild-team-actions">
        <Link className="button" to={base}>
          Open {card.name}
        </Link>
        {(card.signup || card.logs) && (
          <div className="guild-team-more">
            {card.signup && (
              <Link className="button" to={`${base}/signup`}>
                Sign up
              </Link>
            )}
            {card.logs && (
              <a className="button" href={card.logs} target="_blank" rel="noopener">
                Logs
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// Live streams: only who is live now, each in a full player. Nobody live, or a
// failed read, and the section is left out; the Streams page lists everyone.
function LiveNow({ teams }: { teams: TeamInput[] }) {
  const { guild } = useAddress();
  const ids = useMemo(() => teams.map((t) => t.id), [teams]);
  const streamers = useGuildStreamers(ids);
  const titleId = useId();
  if (!streamers.isSuccess) return null;
  const live = guildLive(streamers.data, new Map(teams.map((t) => [t.id, t.name])));
  if (!live.length) return null;

  return (
    <section className="guild-live" aria-labelledby={titleId}>
      <div className="guild-section-head">
        <h2 id={titleId} className="section-title">
          Live now
        </h2>
        <Link to={`/g/${guild.key}/streams`}>All streams</Link>
      </div>
      <ul className="guild-live-list">
        {live.map((stream) => (
          <LiveCard key={stream.id} stream={stream} />
        ))}
      </ul>
    </section>
  );
}

function LiveCard({ stream }: { stream: GuildStream }) {
  return (
    <li className="card guild-live-card">
      <div className="guild-live-embed">
        <iframe
          src={embedSrc(stream.channel, embedParent())}
          title={`${stream.name}’s stream on Twitch`}
          allowFullScreen
          loading="lazy"
        />
      </div>
      <div className="guild-live-body">
        <div>
          <a
            className="stream-name"
            href={`https://twitch.tv/${encodeURIComponent(stream.channel)}`}
            target="_blank"
            rel="noopener"
          >
            {stream.name}
          </a>
          <p className="text-muted guild-live-team">{[stream.team, stream.note].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="stream-live">
          <span className="live-dot" aria-hidden="true" />
          Live
        </span>
      </div>
    </li>
  );
}

// The officers' waiting work, for the teams they staff. A guild officer can
// open other teams' officer pages but cannot read these tables for them, so
// only teams the reader staffs (or every team, for a site admin) count.
function Attention({ teams }: { teams: TeamInput[] }) {
  const { guild } = useAddress();
  const access = useAccess();
  const titleId = useId();
  const staffed = useMemo(
    () =>
      teams.filter((t) => {
        if (!access.data) return false;
        const role = teamRole(access.data, t.id);
        return role === 'officer' || role === 'team_leader' || can(access.data, 'adminSite');
      }),
    [teams, access.data]
  );
  const ids = useMemo(() => staffed.map((t) => t.id), [staffed]);
  const counts = useAttention(ids);
  if (!staffed.length) return null;

  const href = (kind: string, key: string) =>
    kind === 'reviews'
      ? `/g/${guild.key}/t/${key}/officer/reviews`
      : kind === 'signups'
        ? `/g/${guild.key}/t/${key}/roster`
        : `/g/${guild.key}/boe`;

  return (
    <section className="card guild-side-card guild-attention" aria-labelledby={titleId}>
      <div className="guild-section-head">
        <h2 id={titleId} className="section-title">
          Needs your attention
        </h2>
        <span className="text-dim guild-side-note">Officers only</span>
      </div>
      <DataState query={counts} label="what is waiting">
        {(rows) => {
          const waiting = attentionRows(rows, staffed);
          if (!waiting.length) return <p className="text-muted guild-empty">Nothing is waiting on you.</p>;
          return (
            <ul className="guild-attention-list">
              {waiting.map((row) => (
                <li key={row.kind}>
                  <Link className="guild-attention-item" to={href(row.kind, row.teams[0]!.key)}>
                    <span className="guild-attention-top">
                      <span className="guild-attention-label">{row.label}</span>
                      <span className="count-badge">{row.total}</span>
                    </span>
                    <span className="text-muted guild-attention-teams">
                      {row.teams.map((t) => (staffed.length > 1 ? `${t.name} ${t.count}` : t.name)).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </DataState>
    </section>
  );
}

function News() {
  const { guild } = useAddress();
  const titleId = useId();
  const news = useNews();
  return (
    <section className="card guild-side-card" aria-labelledby={titleId}>
      <div className="guild-section-head">
        <h2 id={titleId} className="section-title">
          Latest news
        </h2>
        <Link to={`/g/${guild.key}/news`}>All news</Link>
      </div>
      <DataState query={news} label="the news">
        {(all) => {
          const entries = sortNews(all).slice(0, 3);
          if (!entries.length) return <p className="text-muted guild-empty">No news yet.</p>;
          return (
            <ul className="guild-news">
              {entries.map((entry) => (
                <li key={entry.version}>
                  <span className="guild-news-title">{entry.title}</span>
                  <time className="text-dim guild-news-date" dateTime={entry.date}>
                    {newsShortDate(entry.date)}
                  </time>
                </li>
              ))}
            </ul>
          );
        }}
      </DataState>
    </section>
  );
}

// Nothing to say is better than an empty heading, so no officers (or a failed
// read) leaves the section out, as today.
function Officers() {
  const bios = useGuildOfficers();
  const titleId = useId();
  if (!bios.isSuccess) return null;
  const list = officers(bios.data);
  if (!list.length) return null;
  return (
    <section className="card guild-side-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Guild officers
      </h2>
      <ul className="guild-officers">
        {list.map((officer, i) => (
          <OfficerRow key={`${i}-${officer.name}`} officer={officer} />
        ))}
      </ul>
    </section>
  );
}

function OfficerRow({ officer }: { officer: Officer }) {
  return (
    <li className="guild-officer">
      {officer.photo ? (
        <img className="guild-officer-photo" src={officer.photo} alt="" width={36} height={36} />
      ) : (
        <span className="guild-officer-photo guild-officer-initials" aria-hidden="true">
          {officer.initials}
        </span>
      )}
      <span className="guild-officer-text">
        <span
          className="guild-officer-name"
          style={officer.classKey ? { color: classColor(officer.classKey) } : undefined}
        >
          {officer.name}
        </span>
        {officer.title && <span className="text-muted guild-officer-title">{officer.title}</span>}
      </span>
    </li>
  );
}
