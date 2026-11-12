import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DataState } from '../components/DataState';
import { classColor } from '../roster/roster';
import { localTimeZoneNote, nightInViewerZone } from '../lib/dates';
import { NotFoundPage } from '../pages/NotFoundPage';
import {
  FILTER_LABELS,
  PRIORITY_LABELS,
  joinNote,
  needsRole,
  needsTag,
  progressSummary,
  quickFacts,
  requirements,
  sortedSpots,
  spotLabel,
  type RecruitingTeam,
  type RoleFilter
} from './apply';
import { useCaptureRecruiter } from './recruiterLink';
import { useRecruitingTeams } from './useApply';
import './apply.css';

// The public apply pages (#1546), open to anyone, signed in or not. Looking at
// them never makes anyone a guild member. Mockups: pages 1 and 2 of the
// recruitment canvas.

// The button a team's join method calls for; none for a team not taking
// applications. The form itself is #1538's.
function JoinButton({ team, guildKey }: { team: RecruitingTeam; guildKey: string }) {
  if (!team.taking_applications) return null;
  if (team.join_method === 'application') {
    return (
      <Link className="button button-primary" to={`/g/${guildKey}/apply/${team.slug}/form`}>
        Apply
      </Link>
    );
  }
  return team.ticket_link ? (
    <a className="button button-primary" href={team.ticket_link} target="_blank" rel="noopener noreferrer">
      Open a Discord ticket
    </a>
  ) : null;
}

function Status({ team }: { team: RecruitingTeam }) {
  return (
    <span className={team.taking_applications ? 'apply-status apply-open' : 'apply-status text-dim'}>
      {team.taking_applications ? 'Recruiting' : 'Not recruiting'}
    </span>
  );
}

function Nights({ team }: { team: RecruitingTeam }) {
  if (!team.nights.length) return <p className="text-muted apply-line">No raid nights set yet.</p>;
  return (
    <ul className="apply-rows">
      {team.nights.map((n, i) => {
        const { day, time } = nightInViewerZone(n);
        return (
          <li key={i}>
            <span className="apply-day">
              {day}
              {n.is_optional && <span className="text-dim"> (optional)</span>}
            </span>
            <span>{time}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Spots({ team, playing }: { team: RecruitingTeam; playing: RoleFilter }) {
  if (!team.taking_applications) return <p className="text-muted apply-line">Not recruiting right now.</p>;
  const spots = sortedSpots(team.spots);
  return (
    <>
      {spots.length > 0 && (
        <ul className="apply-rows">
          {spots.map((s, i) => (
            <li key={i} className={playing === 'any' || s.role === playing ? undefined : 'apply-dim'}>
              <span className="apply-spot" style={s.class ? { color: classColor(s.class) } : undefined}>
                {spotLabel(s)}
              </span>
              <span className={`apply-priority apply-priority-${s.priority}`}>{PRIORITY_LABELS[s.priority]}</span>
            </li>
          ))}
        </ul>
      )}
      {team.exceptional_line && <p className="text-muted apply-line">{team.exceptional_line}</p>}
    </>
  );
}

// The first line of a team's About, light Markdown stripped of its marks.
const firstLine = (about: string) => (about.split('\n').find((l) => l.trim()) ?? '').replace(/[*_`#>]/g, '').trim();

function TeamCard({ team, guildKey, role }: { team: RecruitingTeam; guildKey: string; role: RoleFilter }) {
  const match = needsRole(team, role);
  const progress = progressSummary(team.progress);
  const faded = role !== 'any' && !match;
  const titleId = `apply-team-${team.team_id}`;
  return (
    <li>
      <section
        className={`card apply-card${match ? ' apply-match' : ''}${faded ? ' apply-faded' : ''}`}
        aria-labelledby={titleId}
      >
        <div className="apply-card-head">
          <div className="apply-card-title">
            <h2 id={titleId} className="section-title">
              {team.name}
            </h2>
            <Status team={team} />
            {match && role !== 'any' && <span className="apply-needs">{needsTag(role)}</span>}
          </div>
          <div className="apply-actions">
            <Link className="button" to={`/g/${guildKey}/apply/${team.slug}`}>
              See team
            </Link>
            <JoinButton team={team} guildKey={guildKey} />
          </div>
        </div>
        {team.about && <p className="text-muted apply-blurb">{firstLine(team.about)}</p>}
        {team.taking_applications && <p className="text-dim apply-line">How to join: {joinNote(team)}</p>}
        <div className="apply-columns">
          <div>
            <h3 className="apply-heading">Raids</h3>
            <Nights team={team} />
          </div>
          <div>
            <h3 className="apply-heading">Progress</h3>
            {progress ? (
              <>
                <p className="apply-progress">{progress.main}</p>
                <p className="text-dim apply-line">{progress.sub}</p>
              </>
            ) : (
              <p className="text-muted apply-line">No progress yet.</p>
            )}
          </div>
          <div>
            <h3 className="apply-heading">Looking for</h3>
            <Spots team={team} playing={role} />
          </div>
        </div>
      </section>
    </li>
  );
}

// /g/<guild>/apply: the guild's listed teams.
export function GuildApplyPage() {
  const guildKey = useParams()['guildKey'] ?? '';
  useCaptureRecruiter(guildKey);
  const teams = useRecruitingTeams(guildKey);
  const [role, setRole] = useState<RoleFilter>('any');
  return (
    <section className="page apply-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Join us</h1>
        <p className="text-muted page-subtitle">
          Each team below recruits on its own. Pick the one that fits your schedule.
        </p>
      </div>
      <fieldset className="apply-filter">
        <legend>I play</legend>
        {(Object.keys(FILTER_LABELS) as RoleFilter[]).map((r) => (
          <label key={r}>
            <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} /> {FILTER_LABELS[r]}
          </label>
        ))}
      </fieldset>
      <p className="text-dim apply-zone">{localTimeZoneNote()}</p>
      <DataState query={teams} label="the teams">
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-muted">No teams are listed here yet.</p>
          ) : (
            <ul className="apply-list">
              {rows.map((t) => (
                <TeamCard key={t.team_id} team={t} guildKey={guildKey} role={role} />
              ))}
            </ul>
          )
        }
      </DataState>
    </section>
  );
}

// /g/<guild>/apply/<team>: one team.
export function TeamApplyPage() {
  const { guildKey = '', teamKey = '' } = useParams();
  useCaptureRecruiter(guildKey);
  const teams = useRecruitingTeams(guildKey, teamKey);
  return (
    <DataState query={teams} label="this team">
      {(rows) => (rows[0] ? <TeamPage team={rows[0]} guildKey={guildKey} /> : <NotFoundPage />)}
    </DataState>
  );
}

function TeamPage({ team, guildKey }: { team: RecruitingTeam; guildKey: string }) {
  const progress = progressSummary(team.progress);
  const facts = quickFacts(team);
  return (
    <section className="page apply-page" aria-labelledby="page-title">
      <p className="text-dim apply-crumb">
        <Link to={`/g/${guildKey}/apply`}>Join us</Link> / {team.name}
      </p>
      <div className="apply-card-head">
        <div className="page-header">
          <div className="apply-card-title">
            <h1 id="page-title">{team.name}</h1>
            <Status team={team} />
          </div>
          {progress && (
            <p className="text-muted page-subtitle">
              {progress.main} · {progress.sub}
            </p>
          )}
        </div>
        <JoinButton team={team} guildKey={guildKey} />
      </div>
      <div className="apply-grid">
        {team.about && (
          <section className="card apply-block apply-wide" aria-labelledby="apply-about">
            <h2 id="apply-about" className="section-title">
              About the team
            </h2>
            <p className="apply-about">{team.about}</p>
          </section>
        )}
        <section className="card apply-block" aria-labelledby="apply-nights">
          <h2 id="apply-nights" className="section-title">
            Raid nights
          </h2>
          <Nights team={team} />
          <p className="text-dim apply-line">{localTimeZoneNote()}</p>
          {facts.length > 0 && (
            <ul className="apply-facts">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="card apply-block" aria-labelledby="apply-ask">
          <h2 id="apply-ask" className="section-title">
            What we ask for
          </h2>
          <ul className="apply-facts">
            {requirements(team).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
        <section className="card apply-block" aria-labelledby="apply-looking">
          <h2 id="apply-looking" className="section-title">
            Looking for
          </h2>
          <Spots team={team} playing="any" />
        </section>
      </div>
    </section>
  );
}
