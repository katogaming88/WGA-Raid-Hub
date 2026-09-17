import { useState } from 'react';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { classColor, type PlayerRow } from '../roster/roster';
import { shortDay, type Answer, type RaidNight } from './calendar';
import {
  lineupRaids,
  lineupView,
  sameSitouts,
  sitoutsFor,
  sitoutsToSave,
  toggleSitout,
  type LineupRaid,
  type SitoutRow,
  type Sitouts
} from './lineup';
import { useLineupRaids, useSaveLineup, useSitouts } from './useCalendar';

// The officer's boss lineup for a raid night (#1216): raiders down the side,
// the season's bosses across, and a cell to click for each. Board A of the
// boss lineup mockups, chosen 2026-09-17.
export function BossLineup({
  night,
  players,
  answers,
  lastWeek
}: {
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  // Last week's night on the same weekday, to copy from.
  lastWeek: string | null;
}) {
  const team = useTeam();
  const raids = useLineupRaids(team.id);
  const sitouts = useSitouts(team.id, lastWeek ? [night.date, lastWeek] : [night.date]);

  return (
    <DataState query={bothQueries(raids, sitouts)} label="the boss lineup">
      {([settings, rows]) => {
        const list = lineupRaids(settings);
        if (!list.length) {
          return (
            <p className="card calendar-note">
              No bosses are listed for this season yet. Add the season’s raids and bosses in Season Settings to plan a
              lineup.
            </p>
          );
        }
        return (
          <RaidLineups raids={list} rows={rows} night={night} players={players} answers={answers} lastWeek={lastWeek} />
        );
      }}
    </DataState>
  );
}

function RaidLineups({
  raids,
  rows,
  night,
  players,
  answers,
  lastWeek
}: {
  raids: LineupRaid[];
  rows: SitoutRow[];
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  lastWeek: string | null;
}) {
  const [shown, setShown] = useState(raids[0]!.name);
  const raid = raids.find((r) => r.name === shown) ?? raids[0]!;
  return (
    <div className="lineup">
      {raids.length > 1 && (
        <div className="lineup-raids" role="group" aria-label="Raid">
          {raids.map((r) => (
            <button
              key={r.name}
              type="button"
              className={`button${r.name === raid.name ? ' is-chosen' : ''}`}
              aria-pressed={r.name === raid.name}
              onClick={() => setShown(r.name)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      {/* One editor per raid and saved lineup: switching raids, or a save
          landing, starts again from what is saved. */}
      <RaidLineup
        key={`${raid.name}|${[...sitoutsFor(rows, night.date, raid.name)].sort().join(',')}`}
        raid={raid}
        rows={rows}
        night={night}
        players={players}
        answers={answers}
        lastWeek={lastWeek}
        raids={raids.length}
      />
    </div>
  );
}

function RaidLineup({
  raid,
  rows,
  night,
  players,
  answers,
  lastWeek,
  raids
}: {
  raid: LineupRaid;
  rows: SitoutRow[];
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  lastWeek: string | null;
  raids: number;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const save = useSaveLineup(team.id);
  const saved = sitoutsFor(rows, night.date, raid.name);
  const [draft, setDraft] = useState<Sitouts>(saved);
  const view = lineupView(players, night, answers, raid, draft);
  const changed = !sameSitouts(draft, saved);
  const lastWeeks = lastWeek ? sitoutsFor(rows, lastWeek, raid.name) : null;
  const inGrid = view.groups.flatMap((g) => g.rows.map((r) => r.row.player.id));
  const columns = raid.bosses.length + 2;
  const [showBuffs, setShowBuffs] = useState(false);
  const gaps = view.totals.filter((t) => t.problems.length);

  const onSave = () =>
    save.mutate(
      { date: night.date, raid: raid.name, sitouts: sitoutsToSave(draft, raid, inGrid) },
      { onSuccess: () => announce('success', `Saved the ${raid.name} lineup for ${shortDay(night.date)}.`) }
    );

  return (
    <>
      <div className="lineup-bar">
        <p className="lineup-help text-muted">
          {raids > 1 ? `${raid.name}: up` : 'Up'} to {raid.cap} per boss. Click a cell to swap someone in or out.
        </p>
        <div className="lineup-actions">
          {changed && <span className="text-muted lineup-unsaved">Unsaved changes</span>}
          {lastWeeks && (
            <button
              type="button"
              className="button button-quiet"
              disabled={save.isPending || sameSitouts(draft, lastWeeks)}
              onClick={() => setDraft(lastWeeks)}
            >
              Copy last {weekdayName(lastWeek!)}
            </button>
          )}
          <button
            type="button"
            className="button button-primary"
            disabled={save.isPending || !changed}
            onClick={onSave}
          >
            {save.isPending ? 'Saving…' : 'Save lineup'}
          </button>
        </div>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          That did not save: {save.error.message}
        </p>
      )}

      <div className="lineup-layout">
        <div className="card lineup-card">
          <table className="lineup-grid">
            <caption className="visually-hidden">
              {raid.name} lineup for {shortDay(night.date)}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="lineup-name-col">
                  Raider
                </th>
                {view.totals.map((t) => (
                  <th
                    key={t.boss.name}
                    scope="col"
                    className="lineup-boss"
                    title={`${t.boss.name}: ${t.tanks} tanks, ${t.healers} healers, ${t.melee} melee, ${t.ranged} ranged`}
                  >
                    <span className="lineup-boss-name" aria-hidden="true">
                      {t.boss.short}
                    </span>
                    <span className="visually-hidden">{t.boss.name}</span>
                    <span className="lineup-total num" data-tone={t.status.tone} aria-hidden="true">
                      {t.count}/{raid.cap}
                    </span>
                    <span className="lineup-warn" aria-hidden="true">
                      {t.warn}
                    </span>
                  </th>
                ))}
                <th scope="col" className="lineup-count-col">
                  <span className="visually-hidden">Bosses in</span>
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
                  const name = r.row.name;
                  return (
                    <tr key={r.row.player.id}>
                      <th scope="row" className="lineup-raider">
                        <span
                          className="lineup-raider-name"
                          style={{ color: classColor(r.row.player.classes_specs?.class ?? '') }}
                        >
                          {name}
                        </span>{' '}
                        <span className="text-dim lineup-spec">{r.row.player.classes_specs?.spec}</span>
                        {r.tag && <span className="lineup-tag">{r.tag}</span>}
                      </th>
                      {r.cells.map((c) => (
                        <td key={c.boss.name} className="lineup-cell">
                          <button
                            type="button"
                            className={`lineup-toggle${c.in ? ' is-in' : ''}`}
                            aria-pressed={c.in}
                            aria-label={`${name}, ${c.boss.name}: ${c.in ? 'in' : 'sitting out'}`}
                            disabled={save.isPending}
                            onClick={() => setDraft((d) => toggleSitout(d, c.boss.name, r.row.player.id))}
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
          {view.notComing.length > 0 && (
            <p className="lineup-not-coming text-dim">
              Not coming tonight: {view.notComing.map((r) => `${r.name} (${r.status.label.toLowerCase()})`).join(', ')}
            </p>
          )}
        </div>

        <aside className="lineup-side" aria-label="Lineup checks">
          <section className="card lineup-panel" aria-labelledby="needs-look-title">
            <div className="lineup-panel-head">
              <h2 id="needs-look-title">Needs a look</h2>
              <span className="lineup-gap-summary" data-clear={gaps.length === 0}>
                {gaps.length ? `${gaps.length} of ${raid.bosses.length} bosses` : 'All clear'}
              </span>
            </div>
            {gaps.length ? (
              <ul className="lineup-gaps">
                {gaps.map((t) => (
                  <li key={t.boss.name}>
                    <span className="lineup-gap-boss">
                      {raid.bosses.indexOf(t.boss) + 1}. {t.boss.name}
                    </span>
                    <span className="lineup-gap-text">{t.problems.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lineup-all-clear">Every boss is full and every buff is covered.</p>
            )}
            <button
              type="button"
              className="lineup-link"
              aria-expanded={showBuffs}
              aria-controls="all-buffs"
              onClick={() => setShowBuffs((v) => !v)}
            >
              {showBuffs ? 'Hide all buffs' : 'Show all buffs'}
            </button>
          </section>
          {showBuffs && (
            <section id="all-buffs" className="card lineup-panel" aria-labelledby="all-buffs-title">
              <h2 id="all-buffs-title">All buffs, by boss</h2>
              <p className="text-dim lineup-buff-key">
                One square per boss, left to right: {raid.bosses.map((b) => b.short).join(', ')}.
              </p>
              <ul className="lineup-buff-rows">
                {view.buffs.map(({ buff, cells }) => (
                  <li key={buff.name}>
                    <span className="text-muted">{buff.name}</span>
                    <span className="lineup-squares">
                      {cells.map((c) => {
                        const text = c.providers.length
                          ? `${c.boss.short}: ${c.providers.join(', ')}`
                          : `${c.boss.short}: missing`;
                        return (
                          <span
                            key={c.boss.name}
                            className={`lineup-square${c.providers.length ? '' : ' is-missing'}`}
                            title={text}
                          >
                            <span className="visually-hidden">{text}</span>
                          </span>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

const weekdayName = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
