import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { DataState } from '../components/DataState';
import { bothQueries } from '../data/query';
import { useAddress, useTeam } from '../data/address';
import { can, charactersOn, useAccess } from '../auth/access';
import { useSession } from '../auth/session';
import { classColor, equippedItemLevel } from '../roster/roster';
import {
  attendance,
  characterLinks,
  equippedGear,
  formatJoinDate,
  formatPct,
  profileTags,
  seasonLoot,
  type Award
} from './profile';
import {
  useAttendance,
  useCurrentSeason,
  useEquippedGear,
  useLoot,
  useMplusRefusal,
  useProfilePlayer,
  type ProfilePlayer
} from './useProfile';
import { LootPriorityCard, WishlistSummaryCard } from './LootPriorityCard';
import './profile.css';

// A profile opens for the raider it belongs to and for the team's officers
// (Kat, 2026-09-14: same as the current site). The data is public to read;
// this decides what the app offers, like the current site's #517 rule.

// The profile's tabs (Kat, 2026-09-14), each with its own address so a link
// can open one directly, as the bot's wishlist reminder does today.
export const PROFILE_TABS = [
  { key: '', label: 'Overview' },
  { key: 'loot', label: 'Loot' },
  { key: 'wishlist', label: 'Wishlist' }
] as const;

type TabKey = (typeof PROFILE_TABS)[number]['key'];

function Closed({ children }: { children: ReactNode }) {
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Profile</h1>
      <div className="card placeholder">{children}</div>
    </section>
  );
}

// My profile: the signed-in raider's character on this team.
export function MyProfilePage() {
  const { user } = useSession();
  const { guild } = useAddress();
  const team = useTeam();
  const access = useAccess();
  const base = `/g/${guild.key}/t/${team.key}/me`;
  if (!user) {
    return (
      <Closed>
        <p>Sign in to see your profile.</p>
      </Closed>
    );
  }
  if (!access.isSuccess) {
    return (
      <Closed>
        <DataState query={access} label="your access">
          {() => null}
        </DataState>
      </Closed>
    );
  }
  const own = charactersOn(access.data, team.id)[0];
  if (!own) {
    return (
      <Closed>
        <p>You don’t have a character on {team.name} yet.</p>
      </Closed>
    );
  }
  return <ProfileLoader teamId={team.id} by={{ id: own.playerId }} base={base} />;
}

// Someone's profile by its address code, for its raider or an officer.
export function PlayerProfilePage() {
  const { playerCode = '' } = useParams();
  const { user } = useSession();
  const { guild } = useAddress();
  const team = useTeam();
  const access = useAccess();
  const base = `/g/${guild.key}/t/${team.key}/p/${playerCode}`;
  if (!user) {
    return (
      <Closed>
        <p>Sign in to see this profile. Profiles are for the raider and the team’s officers.</p>
      </Closed>
    );
  }
  if (!access.isSuccess) {
    return (
      <Closed>
        <DataState query={access} label="your access">
          {() => null}
        </DataState>
      </Closed>
    );
  }
  const isOfficer = can(access.data, 'viewOfficerTools', team.id);
  const isOwn = charactersOn(access.data, team.id).some((c) => c.urlCode === playerCode.toLowerCase());
  if (!isOfficer && !isOwn) {
    return (
      <Closed>
        <p>You can only open your own profile. Officers can open anyone’s.</p>
      </Closed>
    );
  }
  return <ProfileLoader teamId={team.id} by={{ code: playerCode }} officerView={isOfficer} base={base} />;
}

function ProfileLoader({
  teamId,
  by,
  base,
  officerView = false
}: {
  teamId: number;
  by: { id: number } | { code: string };
  base: string;
  officerView?: boolean;
}) {
  const player = useProfilePlayer(teamId, by);
  const { tab = '' } = useParams();
  // An address naming a tab that does not exist goes to the Overview.
  if (!PROFILE_TABS.some((t) => t.key === tab)) return <Navigate to={base} replace />;
  return (
    <DataState query={player} label="the profile">
      {(p) =>
        p ? (
          <Profile player={p} teamId={teamId} officerView={officerView} base={base} tab={tab as TabKey} />
        ) : (
          <Closed>
            <p>No one on this team’s roster has that profile address.</p>
          </Closed>
        )
      }
    </DataState>
  );
}

// Tabs as links, so each has an address, moved between with the arrow keys
// (#439).
function ProfileTabs({ base, current }: { base: string; current: TabKey }) {
  const navigate = useNavigate();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const href = (key: TabKey) => (key ? `${base}/${key}` : base);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = PROFILE_TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % PROFILE_TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + PROFILE_TABS.length) % PROFILE_TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    void navigate(href(PROFILE_TABS[next]!.key));
    refs.current[next]?.focus();
  };
  return (
    <div className="profile-tabs" role="tablist" aria-label="Profile sections">
      {PROFILE_TABS.map((t, i) => (
        <Link
          key={t.key || 'overview'}
          ref={(el) => {
            refs.current[i] = el;
          }}
          to={href(t.key)}
          role="tab"
          id={`profile-tab-${t.key || 'overview'}`}
          aria-selected={current === t.key}
          aria-controls="profile-panel"
          tabIndex={current === t.key ? 0 : -1}
          className="profile-tab"
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function Profile({
  player,
  teamId,
  officerView,
  base,
  tab
}: {
  player: ProfilePlayer;
  teamId: number;
  officerView: boolean;
  base: string;
  tab: TabKey;
}) {
  const season = useCurrentSeason(teamId);
  const attendanceRows = useAttendance(player.id);
  const loot = useLoot(player.id);
  const gear = useEquippedGear(player.id);
  const refusal = useMplusRefusal(teamId, player.id, officerView && !player.m_plus_excluded);

  const character = player.name_realm.split('-')[0]!.trim();
  const name = player.nickname?.trim() || character;
  const cs = player.classes_specs;
  const links = characterLinks(player.name_realm);
  const tags = profileTags(player);

  const itemLevel = gear.isSuccess ? equippedItemLevel(gear.data.rows) : null;
  const attend =
    season.isSuccess && attendanceRows.isSuccess
      ? attendance(attendanceRows.data, season.data, player.join_date)
      : null;
  const seasonAwards = season.isSuccess && loot.isSuccess ? seasonLoot(loot.data, season.data) : null;

  return (
    <section className="page profile-page" aria-labelledby="page-title">
      <header className="card profile-header">
        <div className="profile-identity">
          <h1 id="page-title" className="profile-name" style={{ color: cs ? classColor(cs.class) : undefined }}>
            {name}
          </h1>
          <p className="profile-line">
            {cs && (
              <>
                <span className="profile-spec">
                  {cs.spec} {cs.class}
                </span>
                <span className="profile-sep" aria-hidden="true">
                  ·
                </span>
                <span className="profile-role">{cs.role}</span>
                <span className="profile-sep" aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <span className="profile-character">{player.name_realm}</span>
          </p>
          {(tags.length > 0 || player.join_date) && (
            <p className="profile-meta">
              {tags.map((t) => (
                <span key={t} className="status-tag profile-tag">
                  {t}
                </span>
              ))}
              {player.join_date && <span className="profile-joined">Joined {formatJoinDate(player.join_date)}</span>}
            </p>
          )}
        </div>
        {links && (
          <nav className="profile-links" aria-label={`${character} on other sites`}>
            <a href={links.warcraftLogs} target="_blank" rel="noopener noreferrer" data-site="warcraftLogs">
              Warcraft Logs
            </a>
            <a href={links.raiderIo} target="_blank" rel="noopener noreferrer" data-site="raiderIo">
              Raider.IO
            </a>
            <a href={links.armory} target="_blank" rel="noopener noreferrer" data-site="armory">
              Armory
            </a>
          </nav>
        )}
      </header>

      <ProfileTabs base={base} current={tab} />

      <div
        id="profile-panel"
        role="tabpanel"
        aria-labelledby={`profile-tab-${tab || 'overview'}`}
        className="profile-panel"
      >
        {tab === '' && (
          <>
            <dl className="profile-stats">
              <Stat label="Item level" value={itemLevel === null ? '–' : itemLevel.toFixed(1)} />
              <Stat label="Attendance" value={attend ? formatPct(attend.pct) : '–'} />
              <Stat
                label="Tier pieces"
                value={player.tier_pieces_equipped === null ? '–' : `${player.tier_pieces_equipped}/5`}
              />
              <Stat label="Items this season" value={seasonAwards ? String(seasonAwards.awards.length) : '–'} />
            </dl>

            <div className="profile-layout">
              <div className="profile-main">
                {/* Equipped gear on the Overview (Kat, 2026-09-14), laid out like the
                    character pane so it stays short. */}
                <section className="card profile-card" aria-labelledby="gear-title">
                  <h2 id="gear-title" className="card-title">
                    Equipped gear
                  </h2>
                  <DataState query={gear} label="equipped gear">
                    {({ rows, names }) => <EquippedGear rows={rows} names={names} />}
                  </DataState>
                </section>

                <LootPriorityCard player={player} teamId={teamId} season={season} loot={loot} />
              </div>

              <aside className="profile-side" aria-label="Wishlist, attendance and M+">
                <WishlistSummaryCard player={player} season={season} />

                <section className="card profile-card" aria-labelledby="attendance-title">
                  <h2 id="attendance-title" className="card-title">
                    Attendance
                  </h2>
                  <DataState query={bothQueries(season, attendanceRows)} label="attendance">
                    {([s, rows]) => <AttendanceCard attend={attendance(rows, s, player.join_date)} />}
                  </DataState>
                </section>

                <section className="card profile-card" aria-labelledby="mplus-title">
                  <h2 id="mplus-title" className="card-title">
                    M+ exclusion
                  </h2>
                  <MplusStatus
                    excluded={player.m_plus_excluded}
                    note={player.m_plus_note}
                    refusal={refusal.isSuccess ? refusal.data : null}
                  />
                </section>
              </aside>
            </div>
          </>
        )}

        {tab === 'loot' && (
          <section className="card profile-card" aria-labelledby="loot-title">
            <h2 id="loot-title" className="card-title">
              Items received
            </h2>
            <DataState query={bothQueries(season, loot)} label="items received">
              {([s, rows]) => <ItemsReceived loot={seasonLoot(rows, s)} />}
            </DataState>
          </section>
        )}

        {tab === 'wishlist' && (
          <div className="profile-wishlist">
            <WishlistSummaryCard player={player} season={season} />
            <div className="card placeholder">
              <p>Choosing BiS or Pass for each slot arrives here next.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card profile-stat">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

const difficultyClass = (d: Award['difficulty']) => `difficulty difficulty-${d.toLowerCase()}`;

function ItemsReceived({ loot }: { loot: ReturnType<typeof seasonLoot> }) {
  if (!loot.awards.length) {
    return <p className="text-muted card-note">Nothing received{loot.season ? ` in ${loot.season}` : ''} yet.</p>;
  }
  return (
    <>
      <p className="loot-summary">
        <span className="num loot-count">{loot.awards.length}</span> {loot.awards.length === 1 ? 'item' : 'items'}
        {loot.season && (
          <>
            {' '}
            in <span className="loot-season">{loot.season}</span>
          </>
        )}
      </p>
      {loot.last && (
        <div className="loot-last">
          <h3 className="loot-last-title">
            Last received <span className="loot-last-date">{loot.last.date}</span>
          </h3>
          <ul className="loot-last-items">
            {loot.last.awards.map((a) => (
              <li key={a.key}>
                <span className="loot-name">{a.name}</span>{' '}
                <span className={difficultyClass(a.difficulty)}>{a.difficulty}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="profile-table-wrap">
        <table className="profile-table loot-table">
          <caption className="visually-hidden">Items received this season, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Difficulty</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {loot.awards.map((a) => (
              <tr key={a.key}>
                <th scope="row" className="loot-name">
                  {a.name}
                </th>
                <td>
                  <span className={difficultyClass(a.difficulty)}>{a.difficulty}</span>
                </td>
                <td className="loot-date">{a.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Laid out like the in-game character pane (Kat, 2026-09-14): Head through
// Wrist on the left, Hands through the trinkets on the right, then Main Hand
// under the left column and Off Hand under the right. Each group is its own
// small table, read left, right, main hand, off hand.
const RIGHT_COLUMN = new Set(['Hands', 'Waist', 'Legs', 'Feet', 'Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2']);

function EquippedGear({ rows, names }: { rows: Parameters<typeof equippedGear>[0]; names: Map<number, string> }) {
  const gear = equippedGear(rows, names);
  if (!gear.length) return <p className="text-muted card-note">No gear synced from Blizzard yet.</p>;
  const columns = [
    {
      key: 'left',
      caption: 'Equipped gear, head to wrists',
      items: gear.filter((g) => !RIGHT_COLUMN.has(g.slot) && g.slot !== 'Main Hand' && g.slot !== 'Off Hand')
    },
    { key: 'right', caption: 'Equipped gear, hands to trinkets', items: gear.filter((g) => RIGHT_COLUMN.has(g.slot)) },
    { key: 'main-hand', caption: 'Equipped main hand', items: gear.filter((g) => g.slot === 'Main Hand') },
    { key: 'off-hand', caption: 'Equipped off hand', items: gear.filter((g) => g.slot === 'Off Hand') }
  ].filter((c) => c.items.length > 0);
  return (
    <div className="gear-columns">
      {columns.map((column) => (
        <div
          key={column.key}
          className={`profile-table-wrap gear-group gear-${column.key}${column.key.endsWith('hand') ? ' gear-weapon' : ''}`}
        >
          <table className="profile-table gear-table">
            <caption className="visually-hidden">{column.caption}</caption>
            {/* The same widths in every group, so the groups line up (profile.css). */}
            <colgroup>
              <col className="gear-col-slot" />
              <col />
              <col className="gear-col-level" />
              <col className="gear-col-track" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Item</th>
                <th scope="col" className="col-num">
                  <abbr title="Item level">ilvl</abbr>
                </th>
                <th scope="col">Track</th>
              </tr>
            </thead>
            <tbody>
              {column.items.map((g) => (
                <tr key={g.slot}>
                  <th scope="row" className="gear-slot">
                    {g.slot}
                  </th>
                  <td className="gear-item">{g.item}</td>
                  <td className="col-num num gear-level">{g.itemLevel ?? '–'}</td>
                  <td className="gear-track">{g.track ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function AttendanceCard({ attend }: { attend: ReturnType<typeof attendance> }) {
  return (
    <>
      <p className="attendance-pct">
        <span className="num">{formatPct(attend.pct)}</span> this season
      </p>
      {attend.flagged.length > 0 ? (
        <>
          <h3 className="side-subtitle">Flagged nights</h3>
          <ul className="attendance-flagged">
            {attend.flagged.map((n) => (
              <li key={`${n.date}-${n.status}`}>
                <span className="num flagged-date">{n.date}</span>
                <span className={n.status === 'No Show' ? 'flagged-status no-show' : 'flagged-status'}>{n.status}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted card-note">No missed or late nights this season.</p>
      )}
    </>
  );
}

function MplusStatus({
  excluded,
  note,
  refusal
}: {
  excluded: boolean;
  note: string | null;
  refusal: { officer_notes: string | null } | null;
}) {
  if (excluded) {
    return (
      <div className="mplus">
        <p>
          <span className="status-tag mplus-status mplus-excluded">Excluded</span> No longer required to run weekly M+.
        </p>
        {note && <p className="mplus-note">{note}</p>}
      </div>
    );
  }
  if (refusal) {
    return (
      <div className="mplus">
        <p>
          <span className="status-tag mplus-status mplus-refused">Rejected</span> The latest exclusion request was not
          approved.
        </p>
        {refusal.officer_notes && <p className="mplus-note">{refusal.officer_notes}</p>}
      </div>
    );
  }
  return <p className="text-muted card-note">Not excluded from weekly M+.</p>;
}
