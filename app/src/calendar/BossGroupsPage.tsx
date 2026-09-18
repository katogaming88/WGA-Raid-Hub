import { useState } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useAddress, useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useTouchScreen } from '../lib/device';
import { classColor, type PlayerRow } from '../roster/roster';
import { useRosterPlayers } from '../roster/useRoster';
import { useLeaveGuard } from './BossLineup';
import { shortDay } from './calendar';
import {
  changes,
  comingNights,
  current,
  everyoneIn,
  groupsView,
  joinNames,
  lineupRaids,
  onRoster,
  placesFor,
  placesOf,
  seasonOn,
  toggle,
  type ComingBossRow,
  type EncounterRow,
  type LeaverRow,
  type LineupRaid,
  type Places,
  type SeasonRow
} from './lineup';
import { isoDate } from './nights';
import {
  useBossGroups,
  useComingNights,
  useEncounters,
  useSaveBossGroups,
  useSeasons,
  type BossSave,
  type SaveResult
} from './useCalendar';

// The officer's Boss groups page (#1216, board I of the boss lineup mockups):
// the usual group for each boss of the season. Every raid night starts as a
// copy of these, and a single night is changed on its Boss lineup tab.
export function BossGroupsPage() {
  const team = useTeam();
  const touch = useTouchScreen();
  const [today] = useState(() => isoDate(new Date()));
  const lookups = bothQueries(useSeasons(), useEncounters());
  const saved = bothQueries(useBossGroups(team.id), useComingNights(team.id, today));
  const page = bothQueries(bothQueries(lookups, useRosterPlayers(team.id)), saved);

  return (
    <section className="page boss-groups-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Boss groups</h1>
        <p className="text-muted page-subtitle">
          The usual group for each boss. Every raid night starts as a copy of these, and you change a single night on
          its Boss lineup tab. Bench raiders start out on raid nights even if they’re in a group.
        </p>
      </div>
      {touch ? (
        // Officer changes need a computer (Kat, 2026-09-16), like the boss lineup.
        <p className="card calendar-note">The boss groups can be changed on a computer.</p>
      ) : (
        <DataState query={page} label="the boss groups">
          {([[[seasons, encounters], players], [groups, coming]]) => (
            <Groups
              today={today}
              seasons={seasons}
              encounters={encounters}
              players={players}
              groups={groups}
              coming={coming}
            />
          )}
        </DataState>
      )}
    </section>
  );
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const toList = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

function Groups({
  today,
  seasons,
  encounters,
  players,
  groups,
  coming
}: {
  today: string;
  seasons: SeasonRow[];
  encounters: EncounterRow[];
  players: PlayerRow[];
  groups: LeaverRow[];
  coming: ComingBossRow[];
}) {
  const team = useTeam();
  const { guild } = useAddress();
  const { announce } = useStatus();
  const [edits, setEdits] = useState<ReadonlyMap<number, ReadonlySet<number>>>(new Map());
  const [shown, setShown] = useState<number | null>(null);
  const [stale, setStale] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const save = useSaveBossGroups(team.id);

  // What the database holds, and the same without anyone who has left the
  // roster: the grid and the save work on the second, the stale check on the
  // first.
  const stored = placesOf(groups);
  const saved = onRoster(stored, players);
  const places = current(saved, edits);
  const changed = changes(saved, edits);
  const dirty = changed.cells > 0;
  const raids = lineupRaids(encounters, [], { fresh: true, season: seasonOn(seasons, today) });
  const bosses = raids.flatMap((r) => r.bosses);
  const names = (ids: number[]) => ids.map((id) => bosses.find((b) => b.id === id)?.name ?? 'A boss').join(', ');
  const leaveDialog = useLeaveGuard(dirty, changed.cells, 'the boss groups');

  if (!raids.length) {
    return (
      <p className="card calendar-note">
        No bosses are loaded for this season yet. They arrive with the next Warcraft Logs sync.
      </p>
    );
  }

  const raid = raids.find((r) => r.zoneId === shown) ?? raids[0]!;
  // A raid nobody has set a group for yet starts from a prompt, not a grid of
  // everyone "in no group".
  const unset = raid.bosses.every((b) => !placesFor(saved, b.id).size && !edits.has(b.id));
  const next = coming[0]?.raid_date;

  const onSave = () =>
    save.mutate(
      changed.bosses.map((id): BossSave => ({
        encounterId: id,
        players: toList(placesFor(places, id)),
        expected: toList(placesFor(stored, id))
      })),
      {
        onSuccess: (result: SaveResult) => {
          const done = 'Saved the boss groups. Coming nights nobody has saved for those bosses follow them now.';
          setEdits((e) => new Map([...e].filter(([id]) => !result.saved.includes(id))));
          setStale(result.stale);
          setMessage(result.stale.length ? '' : done);
          if (!result.stale.length) announce('success', done);
        }
      }
    );

  const barState = stale.length ? 'stale' : save.isError ? 'error' : dirty ? 'dirty' : 'clean';
  const barTitle =
    barState === 'stale'
      ? `${names(stale)} ${stale.length === 1 ? 'wasn’t' : 'weren’t'} saved.`
      : barState === 'error'
        ? 'That did not save.'
        : dirty
          ? `${plural(changed.cells, 'unsaved change')}.`
          : message ||
            (unset
              ? 'Nothing to save yet.'
              : 'No unsaved changes. Click a cell to put someone in a group or take them out.');
  const barHelp =
    barState === 'stale'
      ? 'Someone else changed that group while you were editing, and saving yours would have undone theirs. Your other groups saved.'
      : barState === 'error'
        ? save.error!.message
        : 'Saving changes the usual groups. Coming nights follow, except bosses an officer already saved for that night.';

  return (
    <div className="lineup">
      <div className="boss-groups-top">
        {raids.length > 1 ? (
          <div className="lineup-raids" role="group" aria-label="Raid">
            {raids.map((r) => (
              <button
                key={r.zoneId}
                type="button"
                className={`button${r.zoneId === raid.zoneId ? ' is-chosen' : ''}`}
                aria-pressed={r.zoneId === raid.zoneId}
                onClick={() => setShown(r.zoneId)}
              >
                {r.name} · {r.cap} per boss
              </button>
            ))}
          </div>
        ) : (
          <p className="text-muted boss-groups-raid">
            {raid.name} · {raid.cap} per boss
          </p>
        )}
        {next && (
          <Link className="boss-groups-next" to={`/g/${guild.key}/t/${team.key}/calendar?date=${next}&view=lineup`}>
            {weekday.format(new Date(`${next}T00:00:00`))}’s lineup ›
          </Link>
        )}
      </div>

      <div className="lineup-savebar" data-state={barState} role="status">
        <p>
          <strong>{barTitle}</strong> <span className="text-muted">{barHelp}</span>
        </p>
        <div className="lineup-actions">
          {barState === 'stale' && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setEdits((e) => new Map([...e].filter(([id]) => !stale.includes(id))));
                setStale([]);
              }}
            >
              Show their version
            </button>
          )}
          <button
            type="button"
            className="button button-quiet"
            disabled={save.isPending || !dirty}
            onClick={() => {
              setEdits(new Map());
              setStale([]);
            }}
          >
            Discard
          </button>
          <button type="button" className="button button-primary" disabled={save.isPending || !dirty} onClick={onSave}>
            {save.isPending ? 'Saving…' : 'Save groups'}
          </button>
        </div>
      </div>

      {unset ? (
        <section className="card lineup-empty" aria-labelledby="groups-empty-title">
          <h2 id="groups-empty-title">No boss in {raid.name} has a usual group yet.</h2>
          <p className="text-muted">
            Start with everyone on the roster in (bench raiders out), take people out boss by boss, then press{' '}
            <strong>Save groups</strong>. Every raid night starts from these groups after that.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setEdits((e) => new Map([...e, ...everyoneIn(players, raid.bosses)]));
              setMessage('');
            }}
          >
            Start with everyone in
          </button>
        </section>
      ) : (
        <GroupsGrid
          raid={raid}
          players={players}
          places={places}
          saved={saved}
          groups={groups}
          coming={coming}
          changedBosses={changed.bosses}
          busy={save.isPending}
          onToggle={(boss, id) => {
            setEdits((e) => toggle(saved, e, boss, id));
            setMessage('');
            setStale([]);
          }}
        />
      )}
      {leaveDialog}
    </div>
  );
}

function GroupsGrid({
  raid,
  players,
  places,
  saved,
  groups,
  coming,
  changedBosses,
  busy,
  onToggle
}: {
  raid: LineupRaid;
  players: PlayerRow[];
  places: Places;
  saved: Places;
  groups: LeaverRow[];
  coming: ComingBossRow[];
  changedBosses: number[];
  busy: boolean;
  onToggle: (boss: number, player: number) => void;
}) {
  const view = groupsView(players, raid, places, saved, groups);
  const columns = raid.bosses.length + 2;
  const gaps = view.totals.filter((t) => t.problems.length);
  const nights = comingNights(coming, raid.bosses, changedBosses);
  const roster = [
    ...view.leavers.map(
      (l) => `${l.name} left the roster, so ${plural(l.bosses, 'group is', 'groups are')} one short until you fill it.`
    ),
    ...view.unplaced.map((name) => `${name} is in no group yet.`)
  ];

  return (
    <div className="lineup-layout">
      <div className="card lineup-card">
        <table className="lineup-grid">
          <caption className="visually-hidden">
            {raid.name} boss groups, up to {raid.cap} per boss
          </caption>
          <thead>
            <tr>
              <th scope="col" className="lineup-name-col">
                Raider
              </th>
              {view.totals.map((t) => (
                <th key={t.boss.id} scope="col" className="lineup-boss">
                  <span className="lineup-boss-name" aria-hidden="true">
                    {t.boss.short}
                  </span>
                  <span className="visually-hidden">{t.boss.name}</span>
                  <span className="lineup-total num" data-tone={t.status.tone}>
                    {t.count}/{raid.cap}
                  </span>
                  <span className="lineup-warn">{t.warn}</span>
                  <span className="lineup-mix" aria-hidden="true">
                    {t.tanks}T {t.healers}H {t.damage}D
                  </span>
                  <span className="visually-hidden">
                    {plural(t.tanks, 'tank')}, {plural(t.healers, 'healer')}, {t.damage} damage
                  </span>
                </th>
              ))}
              <th scope="col" className="lineup-count-col">
                <span className="visually-hidden">Groups in</span>
              </th>
            </tr>
          </thead>
          {view.groups.map((g) => (
            <tbody key={g.role}>
              <tr className="lineup-group">
                <th colSpan={columns} scope="colgroup">
                  {g.label}
                </th>
              </tr>
              {g.rows.map((r) => {
                const { player, name } = r.raider;
                return (
                  <tr key={player.id}>
                    <th scope="row" className="lineup-raider">
                      <span
                        className="lineup-raider-name"
                        style={{ color: classColor(player.classes_specs?.class ?? '') }}
                      >
                        {name}
                      </span>{' '}
                      <span className="text-dim lineup-spec">{player.classes_specs?.spec}</span>
                      {r.tag && (
                        <span className="lineup-tag" data-tone={r.tagTone}>
                          {r.tag}
                        </span>
                      )}
                    </th>
                    {r.cells.map((c) => (
                      <td key={c.boss.id} className="lineup-cell">
                        <button
                          type="button"
                          className={`lineup-toggle${c.in ? ' is-in' : ''}${c.changed ? ' is-changed' : ''}`}
                          aria-label={`${name}, ${c.boss.name}: ${c.in ? 'in the group' : 'not in the group'}${c.changed ? ', not saved yet' : ''}`}
                          disabled={busy}
                          onClick={() => onToggle(c.boss.id, player.id)}
                        >
                          <span aria-hidden="true">{c.in ? '✓' : '–'}</span>
                        </button>
                      </td>
                    ))}
                    <td className="lineup-count num text-muted">
                      {r.count}/{raid.bosses.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      <aside className="lineup-side" aria-label="Group checks">
        <section className="card lineup-panel" aria-labelledby="needs-look-title">
          <div className="lineup-panel-head">
            <h2 id="needs-look-title">Needs a look</h2>
            <span className="lineup-gap-summary" data-clear={gaps.length === 0}>
              {gaps.length ? `${gaps.length} of ${plural(raid.bosses.length, 'boss', 'bosses')}` : 'All clear'}
            </span>
          </div>
          {(roster.length > 0 || gaps.length > 0 || view.bench.length > 0) && (
            <ul className="lineup-gaps">
              {roster.length > 0 && (
                <li>
                  <span className="lineup-gap-boss">Roster changes</span>
                  {roster.map((text) => (
                    <span key={text} className="lineup-gap-text" data-tone="warn">
                      {text}
                    </span>
                  ))}
                </li>
              )}
              {gaps.map((t) => (
                <li key={t.boss.id}>
                  <span className="lineup-gap-boss">
                    {raid.bosses.indexOf(t.boss) + 1}. {t.boss.name}
                  </span>
                  <span className="lineup-gap-text">{t.problems.join(' · ')}</span>
                </li>
              ))}
              {view.bench.length > 0 && (
                <li>
                  <span className="lineup-gap-boss">Bench</span>
                  <span className="text-muted lineup-gap-note">
                    {joinNames(view.bench)} {view.bench.length === 1 ? 'is' : 'are'} on the bench: they start out on
                    raid nights even when they’re in a group.
                  </span>
                </li>
              )}
            </ul>
          )}
          {!gaps.length && <p className="lineup-all-clear">Every group is full and every buff is covered.</p>}
        </section>
        <section className="card lineup-panel" aria-labelledby="coming-title">
          <h2 id="coming-title">Coming nights</h2>
          {nights.length ? (
            <>
              <p className="text-dim lineup-buff-key">What saving here changes on nights already filled.</p>
              <ul className="lineup-gaps">
                {nights.map((n) => (
                  <li key={n.date}>
                    <span className="lineup-gap-boss">{shortDay(n.date)}</span>
                    <span className="text-muted lineup-gap-note">{n.text}</span>
                  </li>
                ))}
                <li>
                  <span className="lineup-gap-boss">Later nights</span>
                  <span className="text-muted lineup-gap-note">
                    Not filled yet. They start from the groups as you save them here.
                  </span>
                </li>
              </ul>
            </>
          ) : (
            <p className="text-muted lineup-gap-note">
              No coming night is filled yet. Each one starts from the groups about a week ahead.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
