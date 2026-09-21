import { Fragment, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { can, charactersOn, useAccess } from '../auth/access';
import { useSession } from '../auth/session';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { seasonName } from '../profile/profile';
import { useCurrentSeason } from '../profile/useProfile';
import {
  ROLE_LABELS,
  ROLE_ORDER,
  classColor,
  officerStats,
  summarize,
  summaryLine,
  toIncoming,
  toRoster,
  type OfficerStats,
  type Raider,
  type Role,
  type RoleGroup,
  type RosterSummary
} from './roster';
import { specIcon } from './specIcons';
import { CharacterIcon } from '../characters/CharacterIcon';
import { altCountLabel, altsOf, earlierOwners, type SavedCharacter } from '../characters/characters';
import { useEarlierLoot, useTeamAlts } from '../characters/useCharacters';
import { MainSwapReviews } from '../characters/MainSwapReviews';
import {
  useIncomingRoster,
  useRosterGear,
  useRosterOfficerData,
  useRosterPlayers,
  useSignupSeasons
} from './useRoster';
import './roster.css';

type Filter = Role | 'All';

export function RosterPage() {
  const team = useTeam();
  const current = bothQueries(useRosterPlayers(team.id), useRosterGear(team.id));
  const incoming = bothQueries(useIncomingRoster(team.id), useSignupSeasons(team.id));
  const [tab, setTab] = useState<'current' | 'incoming'>('current');

  const incomingGroups = incoming.isSuccess ? toIncoming(incoming.data[0]) : [];
  const hasIncoming = incomingGroups.length > 0;
  const showing = hasIncoming ? tab : 'current';

  return (
    <section className="page roster-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Roster</h1>
        {current.isSuccess && (
          <p className="text-muted page-subtitle">{summaryLine(summarize(toRoster(...current.data)))}</p>
        )}
      </div>

      {hasIncoming && (
        <RosterTabs
          selected={showing}
          onSelect={setTab}
          incomingLabel={
            // Named after the tier when exactly one is open (#934); the
            // season-agnostic label otherwise.
            incoming.data![1].length === 1
              ? `${seasonName(incoming.data![1][0]!)} Roster (Tentative)`
              : 'Next Season Roster (Tentative)'
          }
        />
      )}

      <div
        id="roster-panel-current"
        role={hasIncoming ? 'tabpanel' : undefined}
        aria-labelledby={hasIncoming ? 'roster-tab-current' : undefined}
        hidden={showing !== 'current'}
      >
        <DataState query={current} label="the roster">
          {([players, gear]) => <CurrentRoster groups={toRoster(players, gear)} players={players} />}
        </DataState>
      </div>

      {hasIncoming && (
        <div
          id="roster-panel-incoming"
          role="tabpanel"
          aria-labelledby="roster-tab-incoming"
          hidden={showing !== 'incoming'}
        >
          <IncomingRoster groups={incomingGroups} />
        </div>
      )}

      {incoming.isError && (
        <DataState query={incoming} label="next season’s roster">
          {() => null}
        </DataState>
      )}
    </section>
  );
}

// Tabs with arrow-key movement between them (#439).
function RosterTabs({
  selected,
  onSelect,
  incomingLabel
}: {
  selected: 'current' | 'incoming';
  onSelect: (tab: 'current' | 'incoming') => void;
  incomingLabel: string;
}) {
  const tabs = [
    { id: 'current' as const, label: 'Current Roster' },
    { id: 'incoming' as const, label: incomingLabel }
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
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
    onSelect(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="roster-tabs" role="tablist" aria-label="Which roster">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`roster-tab-${t.id}`}
          aria-controls={`roster-panel-${t.id}`}
          aria-selected={selected === t.id}
          tabIndex={selected === t.id ? 0 : -1}
          className="roster-tab"
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Who a roster name opens a profile for: every row for the team's officers,
// a raider's own rows for them, and no one else (Kat, 2026-09-14, #868).
function useProfileLinks(teamId: number): (raider: Raider) => string | null {
  const { user } = useSession();
  const access = useAccess();
  if (!user || !access.isSuccess) return () => null;
  const officer = can(access.data, 'viewOfficerTools', teamId);
  const own = new Set(charactersOn(access.data, teamId).map((c) => c.playerId));
  return (raider) =>
    raider.urlCode && (officer || (raider.playerId !== null && own.has(raider.playerId)))
      ? `../p/${raider.urlCode}`
      : null;
}

// Whether the signed-in person is one of this team's officers.
function useIsOfficer(teamId: number): boolean {
  const { user } = useSession();
  const access = useAccess();
  return !!user && access.isSuccess && can(access.data, 'viewOfficerTools', teamId);
}

type RosterPlayers = Parameters<typeof toRoster>[0];

// Each roster row's alts, for officers (#942 step 5b). A saved character that
// is itself on this roster is not an alt here.
function altsByPlayer(
  players: RosterPlayers,
  personByMember: Map<number, number>,
  characters: SavedCharacter[]
): Map<number, SavedCharacter[]> {
  const byPerson = new Map<number, SavedCharacter[]>();
  for (const c of characters) byPerson.set(c.person_id, [...(byPerson.get(c.person_id) ?? []), c]);
  const onRoster = players.map((p) => p.name_realm);
  const out = new Map<number, SavedCharacter[]>();
  for (const p of players) {
    const person = p.team_member_id != null ? personByMember.get(p.team_member_id) : undefined;
    const alts = person !== undefined ? altsOf(byPerson.get(person) ?? [], onRoster) : [];
    if (alts.length) out.set(p.id, alts);
  }
  return out;
}

function CurrentRoster({ groups, players }: { groups: RoleGroup[]; players: RosterPlayers }) {
  const team = useTeam();
  const profileLink = useProfileLinks(team.id);
  // Attendance and items awarded, for officers only (Kat, 2026-09-14): shown
  // to everyone they would invite loot and attendance comparisons.
  const officer = useIsOfficer(team.id);
  const season = useCurrentSeason(team.id);
  // Items include loot on each raider's earlier characters (Kat, 2026-09-15).
  const officerData = bothQueries(
    useRosterOfficerData(team.id, season.isSuccess ? season.data : null, officer),
    useEarlierLoot(team.id, season.isSuccess ? season.data : null, officer)
  );
  const stats =
    officer && season.isSuccess && officerData.isSuccess
      ? officerStats(
          players,
          officerData.data[0].attendance,
          [...officerData.data[0].loot, ...officerData.data[1].loot],
          season.data,
          earlierOwners(officerData.data[1].pairs)
        )
      : null;
  // Alt rows start hidden (Kat, 2026-09-15), and nobody but officers reads them.
  const teamAlts = useTeamAlts(team.id, officer);
  const [showAlts, setShowAlts] = useState(false);
  const alts =
    officer && teamAlts.isSuccess
      ? altsByPlayer(players, teamAlts.data.personByMember, teamAlts.data.characters)
      : null;
  const [filter, setFilter] = useState<Filter>('All');
  const summary = summarize(groups);
  const shown = filter === 'All' ? groups : groups.filter((g) => g.role === filter);

  if (groups.length === 0) {
    return (
      <div className="card placeholder">
        <p>No one is on this team’s roster yet.</p>
      </div>
    );
  }

  // The filter sits above both columns, so the summary panel starts level with
  // the table rather than with the filter (Kat, 2026-09-14).
  return (
    <div className="roster-current">
      {/* Main swaps waiting for an officer (#631), above the team they change. */}
      <MainSwapReviews teamId={team.id} officer={officer} />
      <div className="role-filter" role="group" aria-label="Show role">
        {(['All', ...ROLE_ORDER] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className="role-filter-option"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'All' ? 'Everyone' : ROLE_LABELS[f]}
          </button>
        ))}
      </div>
      {officer && (
        <div className="alts-toggle">
          <div className="role-filter" role="group" aria-label="Alts">
            <button
              type="button"
              className="role-filter-option"
              aria-pressed={showAlts}
              onClick={() => setShowAlts(true)}
            >
              Show alts
            </button>
            <button
              type="button"
              className="role-filter-option"
              aria-pressed={!showAlts}
              onClick={() => setShowAlts(false)}
            >
              Hide alts
            </button>
          </div>
          <span>Only officers see this switch and the rows under a raider.</span>
        </div>
      )}
      {officer && officerData.isError && (
        <DataState query={officerData} label="attendance and items">
          {() => null}
        </DataState>
      )}
      {officer && teamAlts.isError && (
        <DataState query={teamAlts} label="alts">
          {() => null}
        </DataState>
      )}
      <div className="roster-layout">
        <div className="roster-main">
          <RosterTable
            groups={shown}
            caption="Current roster"
            details
            profileLink={profileLink}
            stats={stats}
            alts={alts}
            showAlts={showAlts}
          />
        </div>
        <RosterSummaryPanel summary={summary} />
      </div>
    </div>
  );
}

function IncomingRoster({ groups }: { groups: RoleGroup[] }) {
  const total = groups.reduce((n, g) => n + g.raiders.length, 0);
  return (
    <div className="roster-main">
      <h2 className="section-title">
        {total} Pending Raider{total === 1 ? '' : 's'}
      </h2>
      <p className="text-muted">Approved signups for next season. Not final until the season starts.</p>
      <RosterTable groups={groups} caption="Next season’s tentative roster" details={false} />
    </div>
  );
}

function RosterTable({
  groups,
  caption,
  details,
  profileLink = () => null,
  stats = null,
  alts = null,
  showAlts = false
}: {
  groups: RoleGroup[];
  caption: string;
  details: boolean;
  profileLink?: (raider: Raider) => string | null;
  stats?: Map<number, OfficerStats> | null;
  // Officers only: each row's alts, and whether their rows are showing.
  alts?: Map<number, SavedCharacter[]> | null;
  showAlts?: boolean;
}) {
  const columns = details ? (stats ? 6 : 4) : 1;
  return (
    // Focusable, so the table can be scrolled from the keyboard when it is wider
    // than the screen (axe: scrollable-region-focusable).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="roster-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Raider</th>
            {details && (
              <>
                <th scope="col" className="col-num">
                  Item level
                </th>
                <th scope="col">Tier</th>
                {stats && (
                  <>
                    <th scope="col" className="col-num">
                      Attendance
                    </th>
                    <th scope="col" className="col-num">
                      <abbr title="Items awarded this season">Items</abbr>
                    </th>
                  </>
                )}
                <th scope="col">
                  <span className="visually-hidden">Status</span>
                </th>
              </>
            )}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.role}>
            <tr className="role-row">
              <th scope="rowgroup" colSpan={columns}>
                <span className="role-name">{group.label}</span>{' '}
                <span className="role-count num">{group.raiders.length}</span>
              </th>
            </tr>
            {group.raiders.map((raider) => {
              const raiderAlts = raider.playerId !== null ? (alts?.get(raider.playerId) ?? []) : [];
              return (
                <Fragment key={raider.key}>
                  <RosterRow
                    raider={raider}
                    details={details}
                    href={profileLink(raider)}
                    stats={stats ? (raider.playerId !== null ? (stats.get(raider.playerId) ?? null) : null) : undefined}
                    altCount={raiderAlts.length}
                  />
                  {showAlts &&
                    raiderAlts.map((alt) => (
                      <AltRow key={`alt-${alt.id}`} alt={alt} of={raider.name} withStats={stats !== null} />
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function RosterRow({
  raider,
  details,
  href,
  stats,
  altCount = 0
}: {
  raider: Raider;
  details: boolean;
  href: string | null;
  // Officers only: how many alts the raider listed.
  altCount?: number;
  // Undefined when the columns are not shown; null for a row with no numbers.
  stats?: OfficerStats | null | undefined;
}) {
  const icon = specIcon(raider.className, raider.spec);
  return (
    <tr>
      <th scope="row" className="raider-cell">
        {/* Decorative: the spec is written out below the name. */}
        {icon && <img className="spec-icon" src={icon} alt="" width={20} height={20} loading="lazy" />}
        {href ? (
          <Link to={href} relative="path" className="raider-name" style={{ color: classColor(raider.className) }}>
            {raider.name}
          </Link>
        ) : (
          <span className="raider-name" style={{ color: classColor(raider.className) }}>
            {raider.name}
          </span>
        )}
        {raider.character && <span className="raider-character">{raider.character}</span>}
        {altCount > 0 && <span className="alt-count">{altCountLabel(altCount)}</span>}
        <span className="raider-spec">
          {raider.spec} {raider.className}
        </span>
      </th>
      {details && (
        <>
          <td className="col-num num">
            {raider.itemLevel === null ? (
              <span className="text-dim" title="No gear synced from Blizzard yet">
                <span aria-hidden="true">–</span>
                <span className="visually-hidden">Not synced</span>
              </span>
            ) : (
              raider.itemLevel.toFixed(1)
            )}
          </td>
          <td>
            <TierPieces count={raider.tierPieces} />
          </td>
          {stats !== undefined && (
            <>
              <td className="col-num num roster-attendance">{stats ? `${stats.attendancePct.toFixed(1)}%` : '–'}</td>
              <td className="col-num num roster-items">{stats ? stats.items : '–'}</td>
            </>
          )}
          <td className="status-cell">
            {raider.statuses.map((s) => (
              <span key={s} className={`status-tag status-${s.toLowerCase()}`}>
                {s}
              </span>
            ))}
          </td>
        </>
      )}
    </tr>
  );
}

// An alt under its raider, for officers. No tier, attendance or items: alts
// earn none of them (#942).
function AltRow({ alt, of, withStats }: { alt: SavedCharacter; of: string; withStats: boolean }) {
  const none = (
    <>
      <span aria-hidden="true">–</span>
      <span className="visually-hidden">None</span>
    </>
  );
  return (
    <tr className="alt-row">
      <th scope="row" className="raider-cell">
        <CharacterIcon className={alt.class_name} spec={alt.spec_name} size={20} />
        <span className="raider-name" style={{ color: alt.class_name ? classColor(alt.class_name) : undefined }}>
          {alt.name}
        </span>
        <span className="visually-hidden">, alt of {of}</span>
        <span className="raider-spec">{[alt.spec_name, alt.realm].filter(Boolean).join(' · ')}</span>
      </th>
      <td className="col-num num text-muted">{alt.item_level ?? none}</td>
      <td className="text-dim">{none}</td>
      {withStats && (
        <>
          <td className="col-num text-dim">{none}</td>
          <td className="col-num text-dim">{none}</td>
        </>
      )}
      <td className="status-cell">
        <span className="status-tag">Alt</span>
      </td>
    </tr>
  );
}

// Pips for the look, the number for everyone (#442: never color alone).
function TierPieces({ count }: { count: number | null }) {
  if (count === null) {
    return (
      <span className="text-dim">
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">Not synced</span>
      </span>
    );
  }
  return (
    <span className="tier">
      <span className="tier-pips" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={i < count ? 'tier-pip on' : 'tier-pip'} />
        ))}
      </span>
      <span className="num tier-count">{count}/5</span>
    </span>
  );
}

function RosterSummaryPanel({ summary }: { summary: RosterSummary }) {
  const compositionId = useId();
  const itemLevelId = useId();
  const armorId = useId();
  return (
    <aside className="roster-side" aria-label="Roster summary">
      <section className="card side-card" aria-labelledby={compositionId}>
        <h2 id={compositionId} className="side-title">
          Composition
        </h2>
        <dl className="side-list">
          {summary.roles.map((r) => (
            <div key={r.role}>
              <dt>{r.label}</dt>
              <dd className="num">{r.count}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card side-card" aria-labelledby={itemLevelId}>
        <h2 id={itemLevelId} className="side-title">
          Item level
        </h2>
        {summary.averageItemLevel === null ? (
          <p className="text-muted side-note">No gear synced yet.</p>
        ) : (
          <dl className="side-list">
            <div>
              <dt>Average</dt>
              <dd className="num">{summary.averageItemLevel.toFixed(1)}</dd>
            </div>
            {summary.lowest && (
              <div>
                <dt>Lowest, {summary.lowest.name}</dt>
                <dd className="num">{summary.lowest.itemLevel.toFixed(1)}</dd>
              </div>
            )}
            {summary.withoutGear > 0 && (
              <div>
                <dt>Not synced</dt>
                <dd className="num">{summary.withoutGear}</dd>
              </div>
            )}
          </dl>
        )}
      </section>
      <section className="card side-card" aria-labelledby={armorId}>
        <h2 id={armorId} className="side-title">
          Armor types
        </h2>
        <dl className="side-list">
          {summary.armor.map((a) => (
            <div key={a.type}>
              <dt>{a.type}</dt>
              <dd className="num">{a.count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}
