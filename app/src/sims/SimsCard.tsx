import { useId, useState } from 'react';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { ItemLink } from '../components/ItemLink';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import {
  bestPerItem,
  DIFFICULTY_LABELS,
  showGain,
  isCharacter,
  matchSpec,
  parseSimLink,
  simAgeDays,
  simOrder,
  slotLabel,
  SOURCE_LABELS
} from './sims';
import {
  readReport,
  useClassSpecs,
  usePlayerSims,
  useIsLeaderCharacter,
  useRemoveSim,
  useSaveSims,
  useSimSettings,
  type KnownItem,
  type SavedSim
} from './useSims';
import {
  DEFAULT_SIM_SETTINGS,
  fightStyleLabel,
  setupOf,
  simIsStale,
  simProblems,
  type SimSettings
} from './simSettings';
import './sims.css';

// A raider's sims (#1443): the raider, or an officer who manages loot, pastes
// a Raidbots droptimizer or QE Live upgrade report link. One sim per
// difficulty, spec (#1916) and setup (#1888); a new one replaces the old. The
// team's sim settings turn away a sim that breaks them. Out of date after the
// team's number of days. On a team with wishlists this sits on the Wishlist tab, which shows
// each item's gain beside its marks (Kat, 2026-11-24), so it lists only the
// sims; a Loot council team has no Wishlist tab, so its Sims tab shows each
// sim's upgrades too.
type Character = { id: number; name_realm: string; classes_specs: { class: string; spec: string } | null };

// The character's class and roster spec, whose sim counts (#1916).
const rosterOf = (player: Character) =>
  player.classes_specs ? { className: player.classes_specs.class, spec: player.classes_specs.spec } : null;

export function SimsCard({
  player,
  teamId,
  own,
  upgrades
}: {
  player: Character;
  teamId: number;
  own: boolean;
  upgrades: boolean;
}) {
  const { can } = usePageCan();
  const leader = useIsLeaderCharacter(player.id);
  const canAdd = own || (can('manageLoot') && leader.isSuccess && !leader.data);
  const sims = usePlayerSims(player.id);
  const simSettings = useSimSettings(teamId);
  const settings = simSettings.isSuccess ? simSettings.data : DEFAULT_SIM_SETTINGS;
  return (
    <section className="card profile-card" aria-labelledby="sims-title">
      <h2 id="sims-title" className="card-title">
        Sims
      </h2>
      {canAdd && <AddSim player={player} own={own} settings={settings} />}
      <DataState query={sims} label="sims">
        {({ sims: saved, items }) =>
          saved.length ? (
            simOrder(saved, rosterOf(player)).map((sim) => (
              <SimTable
                key={sim.id}
                sim={sim}
                items={items}
                upgrades={upgrades}
                settings={simSettings.isSuccess ? simSettings.data : null}
                playerId={player.id}
                canRemove={canAdd}
              />
            ))
          ) : (
            <p className="text-muted card-note">No sims yet.</p>
          )
        }
      </DataState>
    </section>
  );
}

function AddSim({ player, own, settings }: { player: Character; own: boolean; settings: SimSettings }) {
  const id = useId();
  const { announce } = useStatus();
  const save = useSaveSims(player.id);
  const specs = useClassSpecs();
  const [link, setLink] = useState('');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = reading || save.isPending;

  const onAdd = async () => {
    setProblem(null);
    const parsed = parseSimLink(link);
    if ('error' in parsed) return setProblem(parsed.error);
    setReading(true);
    const report = await readReport(parsed);
    setReading(false);
    if ('error' in report) return setProblem(report.error);
    if (!isCharacter(player.name_realm, report.character)) {
      const who = [report.character.name, report.character.realm].filter(Boolean).join('-');
      return setProblem(`That report is for ${who}, not ${player.name_realm}.`);
    }
    // The spec it was run as (#1916), which must be the character's class.
    if (!specs.isSuccess) return setProblem('Couldn’t read the list of specs. Reload the page, then try again.');
    const spec = matchSpec(report.spec, specs.data);
    if (!spec) return setProblem(`The hub doesn’t know the spec “${report.spec}”.`);
    const mine = player.classes_specs?.class;
    if (!mine) return setProblem(`${player.name_realm} has no spec on the roster yet. An officer sets it first.`);
    if (spec.class !== mine) {
      return setProblem(
        `That report was run as ${spec.spec} ${spec.class}, and ${player.name_realm}’s class is ${mine}.`
      );
    }
    // The team's settings (#1888): its setups, upgrade level and checks.
    const problems = simProblems(report, settings);
    if (problems.length) return setProblem(`The team’s sim settings turn this one away. ${problems.join(' ')}`);
    save.mutate(
      { report, classSpecId: spec.id },
      {
        onSuccess: () => {
          setLink('');
          const names = report.sims.map((s) => DIFFICULTY_LABELS[s.difficulty]).join(' and ');
          announce('success', `Added the ${names} ${spec.spec} sim from ${SOURCE_LABELS[report.source]}.`);
        },
        onError: (error) => setProblem(errorMessage(error))
      }
    );
  };

  return (
    <form
      className="sims-add"
      onSubmit={(e) => {
        e.preventDefault();
        void onAdd();
      }}
    >
      <label className="field-label" htmlFor={id}>
        Raidbots droptimizer or QE Live upgrade report link
      </label>
      <p className="text-muted sims-hint" id={`${id}-hint`}>
        DPS and tanks: a Raidbots droptimizer. Healers: QE Live’s Upgrade Finder.{' '}
        {own
          ? 'A new sim replaces your one at the same difficulty, spec and setup.'
          : 'A new sim replaces the one at the same difficulty, spec and setup.'}
      </p>
      <div className="sims-add-row">
        <input
          id={id}
          className="input sims-link"
          type="url"
          inputMode="url"
          placeholder="https://www.raidbots.com/simbot/report/…"
          aria-describedby={`${id}-hint${problem ? ` ${id}-problem` : ''}`}
          aria-invalid={problem ? true : undefined}
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" className="button button-primary" disabled={busy || !link.trim()}>
          {busy ? 'Adding…' : 'Add sim'}
        </button>
      </div>
      {problem && (
        <p className="form-error" id={`${id}-problem`} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

const reportUrl = (sim: SavedSim) =>
  sim.source === 'raidbots'
    ? `https://www.raidbots.com/simbot/report/${sim.report_id}`
    : `https://questionablyepic.com/live/upgradereport/${sim.report_id}`;

const ageText = (days: number) => (days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

function SimTable({
  sim,
  items,
  upgrades,
  settings,
  playerId,
  canRemove
}: {
  sim: SavedSim;
  items: KnownItem[];
  upgrades: boolean;
  settings: SimSettings | null;
  playerId: number;
  canRemove: boolean;
}) {
  const { announce } = useStatus();
  const remove = useRemoveSim(playerId);
  const byWowId = new Map(items.map((i) => [i.wow_item_id, i]));
  const shown = settings ?? DEFAULT_SIM_SETTINGS;
  // Which of the team's setups it is (#1888); a QE Live sim is every setup.
  const setup = setupOf(sim, shown.setups);
  const label = `${DIFFICULTY_LABELS[sim.difficulty]} ${sim.spec}${setup && setup !== 'all' && shown.setups.length > 1 ? `, ${setup.name}` : ''}`;
  const stale = settings !== null && simIsStale(sim, settings);
  const rows = bestPerItem(sim.character_sim_results, shown.upgrade[sim.difficulty]).filter(
    (r) => Number(r.pct_gain) > 0
  );
  const titleId = `sim-${sim.id}-title`;

  return (
    <div className={`sims-sim${stale ? ' sims-stale' : ''}${upgrades ? '' : ' sims-compact'}`}>
      {/* With no upgrades table, each sim is one line (the Wishlist tab). */}
      <h3 id={titleId} className="sims-title">
        {label}
      </h3>
      <p className="sims-meta">
        <a href={reportUrl(sim)} target="_blank" rel="noopener noreferrer">
          {SOURCE_LABELS[sim.source]}
        </a>
        <span aria-hidden="true"> · </span>
        <span>simmed {ageText(simAgeDays(sim.simmed_at))}</span>
        {sim.fight_style && (
          <>
            <span aria-hidden="true"> · </span>
            <span>
              {fightStyleLabel(sim.fight_style)}
              {sim.target_count && sim.target_count > 1 ? `, ${sim.target_count} targets` : ''}
            </span>
          </>
        )}
        {settings !== null && setup === null && (
          <>
            <span aria-hidden="true"> · </span>
            <span className="sims-old">Not one of the team’s setups</span>
          </>
        )}
        {settings !== null && (
          <>
            <span aria-hidden="true"> · </span>
            <span className={stale ? 'sims-old' : 'sims-fresh'}>
              {stale ? (settings.staleThen === 'hide' ? 'Out of date, not counted' : 'Out of date') : 'Up to date'}
            </span>
          </>
        )}
        {canRemove && (
          <button
            type="button"
            className="button sims-remove"
            disabled={remove.isPending}
            aria-label={`Remove the ${label} sim`}
            onClick={() =>
              remove.mutate(sim.id, {
                onSuccess: () => announce('success', `Removed the ${label} sim.`),
                onError: (error) => announce('error', errorMessage(error))
              })
            }
          >
            Remove
          </button>
        )}
      </p>
      {!upgrades ? null : rows.length ? (
        <div className="profile-table-wrap">
          <table className="profile-table sims-table" aria-labelledby={titleId}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Slot</th>
                <th scope="col" className="col-num">
                  Item level
                </th>
                <th scope="col" className="col-num">
                  Gain
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const known = byWowId.get(r.wow_item_id);
                const name = known?.name ?? r.item_name ?? `Item ${r.wow_item_id}`;
                return (
                  <tr key={r.id}>
                    <th scope="row">
                      <ItemLink link={{ wowId: r.wow_item_id, ptr: known?.is_ptr ?? false, icon: known?.icon ?? null }}>
                        {name}
                      </ItemLink>
                    </th>
                    <td className="gear-slot">{slotLabel(r.slot)}</td>
                    <td className="col-num num">{r.item_level}</td>
                    <td className="col-num num">
                      {showGain(
                        { pct: Number(r.pct_gain), dps: r.dps_gain === null ? null : Number(r.dps_gain) },
                        shown.gainMode
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted card-note">Nothing in this sim is an upgrade.</p>
      )}
    </div>
  );
}
