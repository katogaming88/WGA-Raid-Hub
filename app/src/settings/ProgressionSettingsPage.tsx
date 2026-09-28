import { useRef, useState } from 'react';
import { useTeam } from '../data/address';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import {
  addBoss,
  addRaid,
  reorderBoss,
  removeBoss,
  removeRaid,
  toggleMiniRaid,
  updateBoss,
  updateRaid,
  type Raid
} from './settings';
import { useProgressionSettings, useSaveRaidProgression } from './useSettings';
import './settings.css';

// The officer dashboard's Raid progression editor (#1357, #1103 row 1), ported
// from tab-season.js's Raid Progression sub-tab: add/remove a raid or boss,
// drag-to-reorder bosses, kill/AOTC dates, and a mini-raid flag (no AOTC
// date). The WCL zone/encounter fetch tools stay on the current site for now
// (#1357: not part of this issue) -- wclZoneId and each boss's
// wclEncounterId are still carried through untouched on save.
export function ProgressionSettingsPage() {
  const team = useTeam();
  const query = useProgressionSettings(team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Raid progression</h1>
      </div>
      <DataState query={query} label="raid progression">
        {(raids) => <ProgressionEditor teamId={team.id} initial={raids} />}
      </DataState>
    </section>
  );
}

function ProgressionEditor({ teamId, initial }: { teamId: number; initial: Raid[] }) {
  const { announce } = useStatus();
  const [raids, setRaids] = useState(initial);
  const save = useSaveRaidProgression(teamId);

  const onSave = () =>
    save.mutate(raids, {
      onSuccess: () => announce('success', 'Saved!'),
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <div className="card settings-card">
      <h2>Raid Progression</h2>
      <p className="text-muted">
        Add one block per raid in the current season. Boss kill dates are shown publicly. Mini-raids have no AOTC date.
      </p>
      <div className="settings-raid-list">
        {raids.length === 0 && <p className="text-muted">No raids added yet. Click "+ Add Raid" to start.</p>}
        {raids.map((raid, i) => (
          <RaidBlock
            key={i}
            raid={raid}
            raidIdx={i}
            onChange={setRaids}
            onRemove={() => setRaids((r) => removeRaid(r, i))}
          />
        ))}
      </div>
      <div className="settings-row">
        <button type="button" className="button" onClick={() => setRaids((r) => addRaid(r))}>
          + Add Raid
        </button>
        <button type="button" className="button button-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save Progression'}
        </button>
      </div>
    </div>
  );
}

function RaidBlock({
  raid,
  raidIdx,
  onChange,
  onRemove
}: {
  raid: Raid;
  raidIdx: number;
  onChange: (updater: (raids: Raid[]) => Raid[]) => void;
  onRemove: () => void;
}) {
  const isMini = !!raid.isMiniRaid;
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <div className="settings-raid-block">
      <div className="settings-row">
        <label className="visually-hidden" htmlFor={`raid-name-${raidIdx}`}>
          Raid name
        </label>
        <input
          id={`raid-name-${raidIdx}`}
          type="text"
          className="input settings-raid-name"
          placeholder="Raid name (e.g. Liberation of Undermine)"
          value={raid.name ?? ''}
          onChange={(e) => onChange((r) => updateRaid(r, raidIdx, { name: e.target.value }))}
        />
        <label className="settings-mini-check">
          <input
            type="checkbox"
            checked={isMini}
            onChange={(e) => onChange((r) => toggleMiniRaid(r, raidIdx, e.target.checked))}
          />
          Mini-raid
        </label>
        <button type="button" className="button button-danger" onClick={onRemove}>
          Remove
        </button>
      </div>

      {!isMini && (
        <div className="settings-row">
          <label className="text-muted" htmlFor={`raid-aotc-${raidIdx}`}>
            AOTC Date
          </label>
          <input
            id={`raid-aotc-${raidIdx}`}
            type="date"
            className="input settings-date"
            value={raid.aotcDate ?? ''}
            onChange={(e) => onChange((r) => updateRaid(r, raidIdx, { aotcDate: e.target.value }))}
          />
        </div>
      )}

      <div className="settings-boss-label">BOSSES</div>
      <div className="settings-boss-list">
        {(raid.bosses ?? []).map((boss, j) => (
          // Native HTML5 drag-and-drop reordering, same as the current site's
          // boss list -- no keyboard equivalent exists there either.
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            key={j}
            className={`settings-boss-row${dragOver === j ? ' is-drag-over' : ''}`}
            draggable
            onDragStart={() => {
              dragFrom.current = j;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOver !== j) setDragOver(j);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = null;
              setDragOver(null);
              if (from === null) return;
              onChange((r) => reorderBoss(r, raidIdx, from, j));
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setDragOver(null);
            }}
          >
            <span className="settings-drag-handle" aria-hidden="true" title="Drag to reorder">
              ⠿
            </span>
            <span className="text-muted">{j + 1}</span>
            <label className="visually-hidden" htmlFor={`boss-name-${raidIdx}-${j}`}>
              Boss name
            </label>
            <input
              id={`boss-name-${raidIdx}-${j}`}
              type="text"
              className="input settings-boss-name"
              placeholder="Boss name"
              value={boss.name ?? ''}
              onChange={(e) => onChange((r) => updateBoss(r, raidIdx, j, { name: e.target.value }))}
            />
            <span className="text-muted">Mythic kill</span>
            <label className="visually-hidden" htmlFor={`boss-date-${raidIdx}-${j}`}>
              Mythic kill date
            </label>
            <input
              id={`boss-date-${raidIdx}-${j}`}
              type="date"
              className="input settings-date"
              value={boss.mythicDate ?? ''}
              onChange={(e) => onChange((r) => updateBoss(r, raidIdx, j, { mythicDate: e.target.value }))}
            />
            <button
              type="button"
              className="button"
              aria-label={`Remove ${boss.name || 'boss'}`}
              onClick={() => onChange((r) => removeBoss(r, raidIdx, j))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="button" onClick={() => onChange((r) => addBoss(r, raidIdx))}>
        + Add Boss
      </button>
    </div>
  );
}
