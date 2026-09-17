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
  type BossTotal,
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
  lastWeek
}: {
  raid: LineupRaid;
  rows: SitoutRow[];
  night: RaidNight;
  players: PlayerRow[];
  answers: Answer[];
  lastWeek: string | null;
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

  const onSave = () =>
    save.mutate(
      { date: night.date, raid: raid.name, sitouts: sitoutsToSave(draft, raid, inGrid) },
      { onSuccess: () => announce('success', `Saved the ${raid.name} lineup for ${shortDay(night.date)}.`) }
    );

  return (
    <>
      <div className="lineup-bar">
        <p className="lineup-help text-muted">
          <strong>
            {raid.name}: up to {raid.cap} raiders per boss.
          </strong>{' '}
          Click a cell to put a raider in or take them out for that boss. Sitting out a boss still counts as coming.
        </p>
        <div className="lineup-actions">
          {changed && <span className="text-muted lineup-unsaved">Unsaved changes</span>}
          {lastWeeks && (
            <button
              type="button"
              className="button"
              disabled={save.isPending || sameSitouts(draft, lastWeeks)}
              onClick={() => setDraft(lastWeeks)}
            >
              Copy last {weekdayName(lastWeek!)}’s lineup
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={save.isPending || draft.size === 0}
            onClick={() => setDraft(new Set())}
          >
            Everyone in
          </button>
          {changed && (
            <button type="button" className="button" disabled={save.isPending} onClick={() => setDraft(saved)}>
              Undo changes
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
              {view.totals.map((t, i) => (
                <th key={t.boss.name} scope="col" className="lineup-boss">
                  <span className="lineup-boss-number num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="lineup-boss-name" title={t.boss.name}>
                    <span aria-hidden="true">{t.boss.short}</span>
                    <span className="visually-hidden">{t.boss.name}</span>
                  </span>
                  <BossCount total={t} cap={raid.cap} header />
                </th>
              ))}
              <th scope="col" className="lineup-count-col">
                Bosses
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
          <tfoot>
            <tr>
              <th scope="row" className="lineup-raider text-muted">
                In for the boss
              </th>
              {view.totals.map((t) => (
                <td key={t.boss.name} className="lineup-foot">
                  <BossCount total={t} cap={raid.cap} />
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
        {view.notComing.length > 0 && (
          <p className="lineup-not-coming text-muted">
            Not coming tonight, so not in the grid:{' '}
            {view.notComing.map((r, i) => (
              <span key={r.player.id}>
                {i > 0 && ', '}
                {r.name} ({r.status.label.toLowerCase()})
              </span>
            ))}
            .
          </p>
        )}
      </div>

      <section className="card lineup-card" aria-labelledby="buff-check-title">
        <h2 id="buff-check-title" className="lineup-section-title">
          Buff check
        </h2>
        <p className="lineup-help text-muted">
          Who brings each raid buff, boss debuff and must-have for every boss, from the lineup above. A cross is a gap;
          hover a tick to see who brings it.
        </p>
        <table className="lineup-grid lineup-buffs">
          <caption className="visually-hidden">Buff check for {raid.name}</caption>
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Buff</th>
              {raid.bosses.map((b) => (
                <th key={b.name} scope="col">
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          {view.buffs.map((group) => (
            <tbody key={group.kind}>
              <tr className="lineup-group">
                <th colSpan={columns} scope="colgroup">
                  {group.kind}
                </th>
              </tr>
              {group.rows.map(({ buff, cells }) => (
                <tr key={buff.name}>
                  <th scope="row" className="lineup-raider">
                    {buff.name} <span className="text-dim lineup-spec">{buff.classes.join(', ')}</span>
                  </th>
                  {cells.map((c) => (
                    <td
                      key={c.boss.name}
                      className={`lineup-buff ${c.providers.length ? 'is-covered' : 'is-missing'}`}
                      title={
                        c.providers.length
                          ? `${c.boss.short}: ${c.providers.join(', ')}`
                          : `${c.boss.short}: nobody brings ${buff.name}`
                      }
                    >
                      {c.providers.length ? (
                        <>
                          <span aria-hidden="true">✓ </span>
                          <span className="num">{c.providers.length}</span>
                          <span className="visually-hidden"> ({c.providers.join(', ')})</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">✗</span>
                          <span className="visually-hidden">Missing</span>
                        </>
                      )}
                    </td>
                  ))}
                  <td className="lineup-count-col" />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </section>
    </>
  );
}

const weekdayName = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

// A boss's count against the cap, its role mix and, in the header, how many
// buffs it is missing. Screen readers get the counts from the footer row, so
// each column's name stays the boss's name.
function BossCount({ total, cap, header = false }: { total: BossTotal; cap: number; header?: boolean }) {
  return (
    <span className="lineup-total" data-tone={total.status.tone} aria-hidden={header || undefined}>
      <span className="lineup-total-count num">
        {total.count}/{cap}
      </span>
      <span className="lineup-total-status">{total.status.text}</span>
      <span className="lineup-total-mix text-dim num">
        {total.tanks}T {total.healers}H {total.dps}D
      </span>
      {header && (
        <span className="lineup-total-buffs" data-missing={total.missingBuffs > 0}>
          {total.missingBuffs
            ? `${total.missingBuffs} buff${total.missingBuffs === 1 ? '' : 's'} missing`
            : 'All buffs'}
        </span>
      )}
    </span>
  );
}
