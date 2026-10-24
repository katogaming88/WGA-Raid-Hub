import { PlayerSettingsButton } from '../roster/PlayerSettings';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
  useRequestSettings,
  type ProfilePlayer
} from './useProfile';
import { useLootCouncil } from '../settings/useSettings';
import { LootPriorityCard, WishlistSummaryCard } from './LootPriorityCard';
import { SignupWishlistTab, WishlistTab } from './WishlistEditor';
import { useOwnSignup, type OwnSignupRow } from '../signup/useSignup';
import { useClassSpecs } from '../characters/useMainSwaps';
import { useSeasons } from '../calendar/useCalendar';
import { MplusRequestButton } from './ProfileForms';
import { CharactersCard } from '../characters/CharactersCard';
import { withEarlierLoot } from '../characters/characters';
import { useAlsoOnTeams, useEarlierLoot } from '../characters/useCharacters';
import './profile.css';
import { SignupButton } from '../signup/SignupButton';

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

type Tab = (typeof PROFILE_TABS)[number];
type TabKey = Tab['key'];

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
  const signup = useOwnSignup(team.id, null);
  const [showProjected, setShowProjected] = useState(false);
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
  const characters = charactersOn(access.data, team.id);
  const own = characters[0];
  // The character they signed up with for the coming season, while it is not
  // one of theirs on the roster yet (#1609): a new person's first, a new main.
  const key = (nameRealm: string) => nameRealm.toLowerCase().replace(/ /g, '');
  const projected =
    signup.data &&
    (signup.data.status === 'pending' || signup.data.status === 'approved') &&
    !characters.some((c) => key(c.nameRealm) === key(signup.data!.signup_name_realm))
      ? signup.data
      : null;
  if (!own && projected)
    return <ProjectedProfile teamId={team.id} signup={projected} base={base} rosterPlayer={null} />;
  if (!own) {
    return (
      <Closed>
        <p>You don’t have a character on {team.name} yet.</p>
        <SignupButton />
      </Closed>
    );
  }
  if (!projected) return <ProfileLoader teamId={team.id} by={{ id: own.playerId }} base={base} own />;
  return (
    <>
      <div className="profile-switch" role="group" aria-label="Character">
        {[
          { label: own.nameRealm, value: false },
          { label: `${projected.signup_name_realm}, next season`, value: true }
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            className={`button${showProjected === o.value ? ' is-chosen' : ''}`}
            aria-pressed={showProjected === o.value}
            onClick={() => setShowProjected(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {showProjected ? (
        <ProjectedWithRoster teamId={team.id} signup={projected} base={base} rosterPlayerId={own.playerId} />
      ) : (
        <ProfileLoader teamId={team.id} by={{ id: own.playerId }} base={base} own />
      )}
    </>
  );
}

// The character someone signed up with, before it is on the roster (#1609),
// shown as its profile will be once it is: built from the signup, so what
// belongs to a character (gear, loot) reads as none yet, and the wishlist is
// the signup's for next season. Attendance and the join date belong to the
// Member and move across with a swap, so they are the roster character's.
function ProjectedWithRoster({
  rosterPlayerId,
  ...props
}: {
  teamId: number;
  signup: OwnSignupRow;
  base: string;
  rosterPlayerId: number;
}) {
  const roster = useProfilePlayer(props.teamId, { id: rosterPlayerId });
  return (
    <DataState query={roster} label="the profile">
      {(rosterPlayer) => <ProjectedProfile {...props} rosterPlayer={rosterPlayer} />}
    </DataState>
  );
}

function ProjectedProfile({
  teamId,
  signup,
  base,
  rosterPlayer
}: {
  teamId: number;
  signup: OwnSignupRow;
  base: string;
  rosterPlayer: ProfilePlayer | null;
}) {
  const specs = useClassSpecs();
  const { tab = '' } = useParams();
  if (!PROFILE_TABS.some((t) => t.key === tab)) return <Navigate to={base} replace />;
  const className = signup.main_swap ? signup.swap_class : signup.class;
  const spec = signup.main_swap ? signup.swap_spec : signup.spec;
  return (
    <DataState query={specs} label="the profile">
      {(rows) => {
        const role = rows.find((r) => r.class === className && r.spec === spec)?.role ?? null;
        const player: ProfilePlayer = {
          // No roster row yet, and no id one could have.
          id: -signup.id,
          name_realm: signup.signup_name_realm,
          nickname: null,
          url_code: null,
          is_trial: false,
          is_bench: false,
          is_rotator: false,
          is_backup_tank: false,
          is_backup_healer: false,
          wishlist_allowed: false,
          m_plus_excluded: false,
          m_plus_note: null,
          join_date: rosterPlayer?.join_date ?? null,
          tier_pieces_equipped: null,
          classes_specs: className && spec ? { class: className, spec, role } : null
        };
        return (
          <Profile
            player={player}
            teamId={teamId}
            own
            base={base}
            tab={tab as TabKey}
            signup={signup}
            attendanceOf={rosterPlayer?.id ?? null}
          />
        );
      }}
    </DataState>
  );
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
  return <ProfileLoader teamId={team.id} by={{ code: playerCode }} officerView={isOfficer} own={isOwn} base={base} />;
}

function ProfileLoader({
  teamId,
  by,
  base,
  officerView = false,
  own = false
}: {
  teamId: number;
  by: { id: number } | { code: string };
  base: string;
  officerView?: boolean;
  // The signed-in raider's own character, which they may edit.
  own?: boolean;
}) {
  const player = useProfilePlayer(teamId, by);
  const { tab = '' } = useParams();
  // An address naming a tab that does not exist goes to the Overview.
  if (!PROFILE_TABS.some((t) => t.key === tab)) return <Navigate to={base} replace />;
  return (
    <DataState query={player} label="the profile">
      {(p) =>
        p ? (
          <Profile player={p} teamId={teamId} officerView={officerView} own={own} base={base} tab={tab as TabKey} />
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
function ProfileTabs({ base, current, tabs }: { base: string; current: TabKey; tabs: readonly Tab[] }) {
  const navigate = useNavigate();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const href = (key: TabKey) => (key ? `${base}/${key}` : base);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    void navigate(href(tabs[next]!.key));
    refs.current[next]?.focus();
  };
  return (
    <div className="profile-tabs" role="tablist" aria-label="Profile sections">
      {tabs.map((t, i) => (
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
  officerView = false,
  own,
  base,
  tab,
  signup,
  attendanceOf = player.id
}: {
  player: ProfilePlayer;
  teamId: number;
  officerView?: boolean;
  own: boolean;
  base: string;
  tab: TabKey;
  // The character someone signed up with, not on the roster yet (#1609), and
  // the Member's roster character whose attendance it carries, if any.
  signup?: OwnSignupRow;
  attendanceOf?: number | null;
}) {
  const season = useCurrentSeason(teamId);
  const attendanceRows = useAttendance(attendanceOf ?? player.id);
  const loot = useLoot(player.id);
  const gear = useEquippedGear(player.id);
  // Officers read every request; a raider reads their own (20260914201423).
  // Loot on the raider's earlier characters counts toward their season total
  // (Kat, 2026-09-15): an old main on this team, or a team they left.
  const { teams } = useAddress();
  const earlier = useEarlierLoot(teamId, season.isSuccess ? season.data : null, true);
  const alsoOn = useAlsoOnTeams(teamId, officerView);
  const alsoOnNames = alsoOn.isSuccess
    ? alsoOn.data.filter((r) => r.player_id === player.id).map((r) => r.team_name)
    : [];
  const refusal = useMplusRefusal(teamId, player.id, (officerView || own) && !player.m_plus_excluded);
  const requests = useRequestSettings(teamId);
  // A Loot council team doesn't use wishlists (#1563).
  const council = useLootCouncil(teamId);
  const tabs = council ? PROFILE_TABS.filter((t) => t.key !== 'wishlist') : PROFILE_TABS;

  const character = player.name_realm.split('-')[0]!.trim();
  const name = player.nickname?.trim() || character;
  const cs = player.classes_specs;
  const links = characterLinks(player.name_realm);
  const tags = profileTags(player);

  const itemLevel = gear.isSuccess ? equippedItemLevel(gear.data.rows) : null;
  // A new person has no nights yet, rather than full credit.
  const attend =
    attendanceOf !== null && season.isSuccess && attendanceRows.isSuccess
      ? attendance(attendanceRows.data, season.data, player.join_date)
      : null;
  const allLoot = bothQueries(loot, earlier);
  const combinedLoot = allLoot.isSuccess
    ? withEarlierLoot(
        player.id,
        allLoot.data[0],
        allLoot.data[1].loot,
        allLoot.data[1].pairs,
        allLoot.data[1].players,
        teamId,
        new Map(teams.map((t) => [t.id, t.name]))
      )
    : null;
  const seasonAwards = season.isSuccess && combinedLoot ? seasonLoot(combinedLoot, season.data) : null;

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
          {(tags.length > 0 || alsoOnNames.length > 0 || player.join_date) && (
            <p className="profile-meta">
              {tags.map((t) => (
                <span key={t} className="status-tag profile-tag">
                  {t}
                </span>
              ))}
              {alsoOnNames.map((n) => (
                <span key={n} className="status-tag profile-tag">
                  Also on {n}
                </span>
              ))}
              {player.join_date && <span className="profile-joined">Joined {formatJoinDate(player.join_date)}</span>}
            </p>
          )}
          {signup && (
            <p className="profile-meta">
              <span className="status-tag profile-tag">Next season</span>
              <span className="profile-joined">
                Signed up for <SeasonName code={signup.season} />. Joins the roster when signups close.
              </span>
            </p>
          )}
          {own && <SignupButton />}
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
        {/* Officers change this player's settings from here too (#1360). */}
        {officerView && <PlayerSettingsButton teamId={teamId} target={{ playerId: player.id, name }} />}
      </header>

      <ProfileTabs base={base} current={tab} tabs={tabs} />

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
              <Stat label="Items this season" value={seasonAwards ? String(seasonAwards.count) : '–'} />
            </dl>

            {/* Equipped gear on the Overview, full width so both columns fit without
                wrapping (Kat, 2026-09-14), laid out like the character pane. */}
            <section className="card profile-card" aria-labelledby="gear-title">
              <h2 id="gear-title" className="card-title">
                Equipped gear
              </h2>
              <DataState query={gear} label="equipped gear">
                {({ rows, names }) => <EquippedGear rows={rows} names={names} />}
              </DataState>
            </section>

            <div className="profile-layout">
              <div className="profile-main">
                {council ? (
                  <CouncilCard />
                ) : (
                  <LootPriorityCard player={player} teamId={teamId} season={season} loot={loot} own={own} />
                )}
              </div>

              <aside className="profile-side" aria-label="Characters, wishlist, attendance and M+">
                {/* Alts are chosen for a roster character. */}
                {!signup && <CharactersCard player={player} itemLevel={itemLevel} own={own} />}
                {!council &&
                  (signup ? (
                    <SignupWishlistSummary player={player} season={season} signup={signup} />
                  ) : (
                    <WishlistSummaryCard player={player} season={season} />
                  ))}

                <section className="card profile-card" aria-labelledby="attendance-title">
                  <h2 id="attendance-title" className="card-title">
                    Attendance
                  </h2>
                  <DataState query={bothQueries(season, attendanceRows)} label="attendance">
                    {([s, rows]) =>
                      attendanceOf === null ? (
                        <p className="text-muted card-note">Counts from when it joins the roster.</p>
                      ) : (
                        <AttendanceCard attend={attendance(rows, s, player.join_date)} />
                      )
                    }
                  </DataState>
                </section>

                {/* An exclusion is asked for a roster character. */}
                {!signup && (
                  <section className="card profile-card" aria-labelledby="mplus-title">
                    <h2 id="mplus-title" className="card-title">
                      M+ exclusion
                    </h2>
                    <MplusStatus
                      excluded={player.m_plus_excluded}
                      note={player.m_plus_note}
                      refusal={refusal.isSuccess ? refusal.data : null}
                      request={
                        own && requests.isSuccess && !player.m_plus_excluded
                          ? { open: requests.data.mplusOpen, player, raiderIoUrl: links?.raiderIo ?? '' }
                          : null
                      }
                    />
                  </section>
                )}
              </aside>
            </div>
          </>
        )}

        {tab === 'loot' && (
          <section className="card profile-card" aria-labelledby="loot-title">
            <h2 id="loot-title" className="card-title">
              Items received
            </h2>
            <DataState query={bothQueries(season, allLoot)} label="items received">
              {([s]) => <ItemsReceived loot={seasonLoot(combinedLoot ?? [], s)} />}
            </DataState>
          </section>
        )}

        {tab === 'wishlist' &&
          (council ? (
            <CouncilCard />
          ) : signup ? (
            <SignupWishlistTab player={player} teamId={teamId} season={season} signup={signup} />
          ) : (
            <WishlistTab player={player} teamId={teamId} season={season} own={own} />
          ))}
      </div>
    </section>
  );
}

// A season by its stored name. Read only where a signup needs it, so a roster
// profile's Overview leaves the season list to the Wishlist tab.
function SeasonName({ code }: { code: string }) {
  const seasons = useSeasons();
  return <>{seasons.data?.find((s) => s.code === code)?.display_name ?? code}</>;
}

// The Overview's wishlist count for a signup: its picks, in its season (#1609).
function SignupWishlistSummary({
  player,
  season,
  signup
}: {
  player: ProfilePlayer;
  season: ReturnType<typeof useCurrentSeason>;
  signup: OwnSignupRow;
}) {
  const seasons = useSeasons();
  const name = seasons.data?.find((s) => s.code === signup.season)?.display_name ?? signup.season;
  return (
    <WishlistSummaryCard
      player={player}
      season={season}
      owner={{ signupId: signup.id, season: signup.season }}
      seasonOf={{ reads: seasons, code: signup.season, name }}
    />
  );
}

// In place of the Loot priority card and the Wishlist tab on a Loot council
// team (#1563).
function CouncilCard() {
  return (
    <section className="card profile-card" aria-labelledby="council-title">
      <h2 id="council-title" className="card-title">
        Loot
      </h2>
      <p className="card-note">Loot on this team is decided by the loot council, from the rolls in game.</p>
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

export const difficultyClass = (d: Award['difficulty']) => `difficulty difficulty-${d.toLowerCase()}`;

function ItemsReceived({ loot }: { loot: ReturnType<typeof seasonLoot> }) {
  if (!loot.awards.length) {
    return <p className="text-muted card-note">Nothing received{loot.season ? ` in ${loot.season}` : ''} yet.</p>;
  }
  return (
    <>
      <p className="loot-summary">
        <span className="num loot-count">{loot.count}</span> {loot.count === 1 ? 'item' : 'items'}
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
                <ReceivedOn from={a.from} />
                <NotCounted award={a} />
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
                  <ReceivedOn from={a.from} />
                  <NotCounted award={a} />
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

// An item received on an earlier character: an old main, or a team the raider
// left. Their own character's items carry no mark.
// An Off spec award the team's button list leaves out of the count (#1561).
export function NotCounted({ award }: { award: Award }) {
  return award.counted ? null : (
    <span className="loot-offspec" title="Its response counts as Off spec, so it is not counted">
      Off spec
    </span>
  );
}

function ReceivedOn({ from }: { from: string | null }) {
  return from ? (
    <>
      {' '}
      <span className="loot-from">on {from}</span>
    </>
  ) : null;
}

// Laid out like the in-game character pane (Kat, 2026-09-14): Head through
// Wrist on the left, Hands through the trinkets on the right, weapons across
// the bottom (Kat preferred this to one weapon under each column). Each group
// is its own small table, read left, right, bottom.
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
    {
      key: 'weapons',
      caption: 'Equipped weapons',
      items: gear.filter((g) => g.slot === 'Main Hand' || g.slot === 'Off Hand')
    }
  ].filter((c) => c.items.length > 0);
  return (
    <div className="gear-columns">
      {columns.map((column) => (
        <div key={column.key} className={`profile-table-wrap gear-group gear-${column.key}`}>
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

// The raider's own M+ exclusion: their status, and the request form while the
// team takes requests.
function MplusStatus({
  excluded,
  note,
  refusal,
  request
}: {
  excluded: boolean;
  note: string | null;
  refusal: { officer_notes: string | null } | null;
  request: { open: boolean; player: ProfilePlayer; raiderIoUrl: string } | null;
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
  const action = request ? (
    request.open ? (
      <MplusRequestButton player={request.player} raiderIoUrl={request.raiderIoUrl} again={!!refusal} />
    ) : (
      <p className="text-muted card-note mplus-closed">M+ exclusion requests are closed right now.</p>
    )
  ) : null;
  if (refusal) {
    return (
      <div className="mplus">
        <p>
          <span className="status-tag mplus-status mplus-refused">Rejected</span> The latest exclusion request was not
          approved.
        </p>
        {refusal.officer_notes && <p className="mplus-note">{refusal.officer_notes}</p>}
        {request?.open && action}
      </div>
    );
  }
  return (
    <div className="mplus">
      <p className="text-muted card-note">Not excluded from weekly M+.</p>
      {action}
    </div>
  );
}
