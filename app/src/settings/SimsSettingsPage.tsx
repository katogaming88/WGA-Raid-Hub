import { useId, useState } from 'react';
import { useTeam } from '../data/address';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import type { Difficulty } from '../sims/sims';
import {
  CHECKS,
  describeSetup,
  FIGHT_STYLES,
  type SimSettings,
  type SimSetup,
  type UpgradeMode
} from '../sims/simSettings';
import { useSaveSimSettings, useSimSettings } from '../sims/useSims';
import { LootSettingsTabs } from './LootSettingsPage';
import './settings.css';

// Settings > Loot > Sims (#1888 part 1; mockup decided with Kat 2026-10-18,
// calls on 2026-11-25): how gains show, which difficulties need a sim and the
// level items are simmed at, the team's named setups and their weights, the
// checks every sim must pass, and when a sim goes out of date. The team
// leader edits it, like the rest of Settings > Loot (set_team_setting() is
// team leader or site admin); officers see it read-only.
export function SimsSettingsPage() {
  const team = useTeam();
  const query = useSimSettings(team.id);
  const { can } = usePageCan();
  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Loot settings</h1>
      </div>
      <LootSettingsTabs />
      <DataState query={query} label="sim settings">
        {(saved) => <SimsForm key={JSON.stringify(saved)} teamId={team.id} saved={saved} canEdit={can('leadTeam')} />}
      </DataState>
    </section>
  );
}

const NEEDED: Difficulty[] = ['normal', 'heroic', 'mythic'];
const NAMES: Record<Difficulty, string> = { lfr: 'Raid Finder', normal: 'Normal', heroic: 'Heroic', mythic: 'Mythic' };
const share = (setups: SimSetup[], s: SimSetup) => {
  const total = setups.reduce((a, x) => a + x.weight, 0);
  return total > 0 ? Math.round((s.weight / total) * 100) : Math.round(100 / setups.length);
};

// Why the settings can't be saved yet, in plain words; none: they can.
export function simSettingsProblems(s: SimSettings): string[] {
  const problems: string[] = [];
  if (s.setups.some((x) => !x.name.trim())) problems.push('Give every setup a name.');
  const names = s.setups.map((x) => x.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) problems.push('Two setups have the same name.');
  const shapes = s.setups.map((x) => `${x.fightStyle}|${x.targets}|${x.minutes}`);
  if (new Set(shapes).size !== shapes.length) problems.push('Two setups have the same fight, targets and length.');
  if (s.setups.some((x) => !Number.isInteger(x.targets) || x.targets < 1 || x.targets > 100))
    problems.push('Targets must be a whole number from 1 to 100.');
  if (s.setups.some((x) => !Number.isInteger(x.minutes) || x.minutes < 1 || x.minutes > 60))
    problems.push('Length must be a whole number of minutes from 1 to 60.');
  if (s.setups.some((x) => !Number.isFinite(x.weight) || x.weight < 0) || s.setups.every((x) => x.weight === 0))
    problems.push('Weights must be 0 or more, and at least one above 0.');
  if (!Number.isInteger(s.staleDays) || s.staleDays < 1 || s.staleDays > 365)
    problems.push('Enter a whole number of days, from 1 to 365.');
  return problems;
}

function SimsForm({ teamId, saved, canEdit }: { teamId: number; saved: SimSettings; canEdit: boolean }) {
  const id = useId();
  const { announce } = useStatus();
  const save = useSaveSimSettings(teamId);
  const [s, setS] = useState(saved);
  const set = (patch: Partial<SimSettings>) => setS((old) => ({ ...old, ...patch }));
  const setSetup = (i: number, patch: Partial<SimSetup>) =>
    set({ setups: s.setups.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const problems = simSettingsProblems(s);
  const nextId = () => {
    let n = s.setups.length + 1;
    while (s.setups.some((x) => x.id === `setup${n}`)) n += 1;
    return `setup${n}`;
  };

  const onSave = () =>
    save.mutate(
      { ...s, setups: s.setups.map((x) => ({ ...x, name: x.name.trim() })) },
      {
        onSuccess: () => announce('success', 'Saved!'),
        onError: (error) => announce('error', errorMessage(error))
      }
    );

  return (
    <form
      className="settings-cards"
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit && dirty && !problems.length) onSave();
      }}
    >
      {!canEdit && <p className="text-muted">Only the team leader can change these.</p>}
      <fieldset className="card settings-card sims-settings" disabled={!canEdit}>
        <legend className="sims-legend">
          <h2>General</h2>
        </legend>
        <p className="text-muted">
          DPS and tanks add Raidbots droptimizers; healers add QE Live upgrade reports, which have none of these
          choices, so only the difficulties and the level apply to them.
        </p>
        <fieldset className="sims-group">
          <legend className="field-label">Difficulties that need a sim</legend>
          <div className="settings-row">
            {NEEDED.map((d) => (
              <label key={d} className="settings-row">
                <input
                  type="checkbox"
                  checked={s.difficulties.includes(d)}
                  onChange={(e) =>
                    set({
                      difficulties: e.target.checked
                        ? NEEDED.filter((x) => x === d || s.difficulties.includes(x))
                        : s.difficulties.filter((x) => x !== d)
                    })
                  }
                />
                {NAMES[d]}
              </label>
            ))}
          </div>
          <p className="text-muted sims-hint">Missing sims lists who has none at these.</p>
        </fieldset>
        <fieldset className="sims-group">
          <legend className="field-label">Items simmed at</legend>
          {NEEDED.filter((d) => s.difficulties.includes(d)).map((d) => (
            <label key={d} className="settings-row">
              <span className="sims-row-label">{NAMES[d]}</span>
              <select
                className="select"
                value={s.upgrade[d]}
                onChange={(e) => set({ upgrade: { ...s.upgrade, [d]: e.target.value as UpgradeMode } })}
              >
                <option value="max">Fully upgraded</option>
                <option value="drop">As it drops</option>
              </select>
            </label>
          ))}
          <p className="text-muted sims-hint">
            Everyone sims at the same level so gains compare. QE Live shows this level; a Raidbots sim at another is
            turned away.
          </p>
        </fieldset>
        <fieldset className="sims-group">
          <legend className="field-label">Equipped gear</legend>
          <div className="settings-row">
            {(
              [
                ['asIs', 'As it is'],
                ['upgraded', 'Fully upgraded']
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="settings-row">
                <input
                  type="radio"
                  name={`${id}-equipped`}
                  checked={s.equipped === value}
                  onChange={() => set({ equipped: value })}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-muted sims-hint">
            How the raider’s own gear is simmed, the item each drop is compared against.
          </p>
        </fieldset>
        <fieldset className="sims-group">
          <legend className="field-label">Show gains as</legend>
          <div className="settings-row">
            {(
              [
                ['percent', 'Percent'],
                ['raw', 'Raw numbers']
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="settings-row">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  checked={s.gainMode === value}
                  onChange={() => set({ gainMode: value })}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-muted sims-hint">
            {s.gainMode === 'percent' ? 'For example +4.10%.' : 'For example +2,950 DPS.'} Healers always show a
            percent, since QE Live only gives one. The Priority page sorts by the percent either way.
          </p>
        </fieldset>
      </fieldset>

      <fieldset className="card settings-card sims-settings" disabled={!canEdit}>
        <legend className="sims-legend">
          <h2>Setups</h2>
        </legend>
        <p className="text-muted">
          A raider adds one Raidbots sim per setup. The gain officers see is the average by weight, and a setup a raider
          hasn’t added counts as no gain. A QE Live sim counts as every setup. A sim that matches none of these is
          turned away, and one added before a setup changed stops counting.
        </p>
        <div className="sims-table-wrap">
          <table className="settings-roster-table sims-setups">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Fight</th>
                <th scope="col">Targets</th>
                <th scope="col">Minutes</th>
                <th scope="col">Weight</th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {s.setups.map((x, i) => (
                <tr key={x.id}>
                  <td>
                    <input
                      className="input"
                      aria-label={`Setup ${i + 1} name`}
                      value={x.name}
                      maxLength={40}
                      onChange={(e) => setSetup(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      aria-label={`${x.name || `Setup ${i + 1}`} fight`}
                      value={x.fightStyle}
                      onChange={(e) => setSetup(i, { fightStyle: e.target.value })}
                    >
                      {Object.entries(FIGHT_STYLES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input settings-number"
                      type="number"
                      min={1}
                      max={100}
                      aria-label={`${x.name || `Setup ${i + 1}`} targets`}
                      value={x.targets}
                      onChange={(e) => setSetup(i, { targets: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="input settings-number"
                      type="number"
                      min={1}
                      max={60}
                      aria-label={`${x.name || `Setup ${i + 1}`} minutes`}
                      value={x.minutes}
                      onChange={(e) => setSetup(i, { minutes: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <span className="settings-row">
                      <input
                        className="input settings-number"
                        type="number"
                        min={0}
                        aria-label={`${x.name || `Setup ${i + 1}`} weight`}
                        value={x.weight}
                        onChange={(e) => setSetup(i, { weight: Number(e.target.value) })}
                      />
                      {s.setups.length > 1 && <span className="text-muted">{share(s.setups, x)}%</span>}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Remove ${x.name || `setup ${i + 1}`}`}
                      disabled={s.setups.length <= 1}
                      onClick={() => set({ setups: s.setups.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="settings-row">
          <button
            type="button"
            className="button"
            onClick={() =>
              set({
                setups: [
                  ...s.setups,
                  { id: nextId(), name: '', fightStyle: 'Patchwerk', targets: 3, minutes: 5, weight: 1 }
                ]
              })
            }
          >
            Add a setup
          </button>
        </div>
        <p className="text-muted sims-hint">
          {s.setups.map((x) => `${x.name || 'New setup'}: ${describeSetup(x)}`).join('. ')}.
        </p>
      </fieldset>

      <fieldset className="card settings-card sims-settings" disabled={!canEdit}>
        <legend className="sims-legend">
          <h2>Every sim must</h2>
        </legend>
        <p className="text-muted">
          Checked when a raider adds a Raidbots sim; one that fails is turned away with the reason. QE Live reports
          don’t say, so they always pass.
        </p>
        {CHECKS.map((c) => (
          <label key={c.key} className="sims-check">
            <input
              type="checkbox"
              checked={s.checks[c.key]}
              onChange={(e) => set({ checks: { ...s.checks, [c.key]: e.target.checked } })}
            />
            <strong>{c.label}</strong>
            <span className="text-muted">{c.hint}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="card settings-card sims-settings" disabled={!canEdit}>
        <legend className="sims-legend">
          <h2>Out of date</h2>
        </legend>
        <div className="settings-row">
          <label htmlFor={`${id}-days`}>A sim goes out of date after</label>
          <input
            id={`${id}-days`}
            className="input settings-number"
            type="number"
            min={1}
            max={365}
            value={s.staleDays}
            aria-describedby={`${id}-days-unit`}
            onChange={(e) => set({ staleDays: Number(e.target.value) })}
          />
          <span id={`${id}-days-unit`}>days</span>
        </div>
        <p className="text-muted sims-hint">Then it’s greyed out and counts as no sim.</p>
      </fieldset>

      {canEdit && (
        <div className="sims-save" role="group" aria-label="Save sim settings">
          <div className="settings-row">
            <button
              type="submit"
              className="button button-primary"
              disabled={save.isPending || !dirty || problems.length > 0}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="button" disabled={!dirty || save.isPending} onClick={() => setS(saved)}>
              Undo changes
            </button>
          </div>
          {problems.length > 0 && (
            <ul className="form-error sims-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
