import { useId, useState } from 'react';
import { useTeam } from '../data/address';
import { usePageCan } from '../auth/access';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { LOOT_SYSTEMS, type LootSystem } from './settings';
import {
  useLootAccess,
  useLootResponses,
  useLootSettings,
  useSaveLootAccess,
  useSaveLootSystem,
  type LootAccess
} from './useSettings';
import { LootReceivedCard } from './LootReceivedCard';
import { useSaveSimStaleDays, useSimStaleDays } from '../sims/useSims';
import './settings.css';

// Settings > Loot (#1560): the team leader picks how the team hands out loot;
// officers see the page read-only. set_team_setting is team-leader/site-admin
// only by RLS, so hiding Save from an officer only saves them a refusal.
// What gets counted as loot received (#1561) is officer-run, so it has its
// own card and save. The access card is team leader only, like the loot
// system. Bosses in reach (#1562) comes later.
export function LootSettingsPage() {
  const team = useTeam();
  const query = useLootSettings(team.id);
  const { can } = usePageCan();
  const canEdit = can('leadTeam');
  const responses = useLootResponses(team.id);
  const access = useLootAccess(team.id);
  const staleDays = useSimStaleDays(team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Loot settings</h1>
      </div>
      <div className="settings-cards">
        <DataState query={query} label="loot settings">
          {(saved) => <LootSystemCards key={saved} teamId={team.id} saved={saved} canEdit={canEdit} />}
        </DataState>
        <DataState query={responses} label="loot buttons">
          {(data) => (
            <LootReceivedCard
              key={JSON.stringify(data.list)}
              teamId={team.id}
              data={data}
              canEdit={can('manageLoot')}
            />
          )}
        </DataState>
        <DataState query={access} label="loot access">
          {(saved) => <LootAccessCard key={JSON.stringify(saved)} teamId={team.id} saved={saved} canEdit={canEdit} />}
        </DataState>
        <DataState query={staleDays} label="sim settings">
          {(saved) => <SimsCard key={saved} teamId={team.id} saved={saved} canEdit={canEdit} />}
        </DataState>
      </div>
    </section>
  );
}

// How many days a raider's sim stays up to date (#1443), 14 until the team
// leader changes it. After that it is greyed out and counts as no sim.
function SimsCard({ teamId, saved, canEdit }: { teamId: number; saved: number; canEdit: boolean }) {
  const id = useId();
  const { announce } = useStatus();
  const [days, setDays] = useState(String(saved));
  const save = useSaveSimStaleDays(teamId);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;

  const onSave = () =>
    save.mutate(n, {
      onSuccess: () => announce('success', 'Saved!'),
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <div className="card settings-card">
      <h2>Sims</h2>
      <p className="text-muted">
        Raiders add a Raidbots droptimizer or QE Live upgrade report on their profile. An old sim is greyed out and
        counts as no sim.
      </p>
      <div className="field">
        <label className="field-label" htmlFor={id}>
          A sim goes out of date after
        </label>
        <div className="settings-row">
          <input
            id={id}
            className="input settings-days"
            type="number"
            min={1}
            max={365}
            step={1}
            value={days}
            disabled={!canEdit}
            aria-describedby={`${id}-unit`}
            onChange={(e) => setDays(e.target.value)}
          />
          <span id={`${id}-unit`}>days</span>
        </div>
        {!valid && <p className="form-error">Enter a whole number of days, from 1 to 365.</p>}
      </div>
      {canEdit ? (
        <div className="settings-row">
          <button
            type="button"
            className="button button-primary"
            onClick={onSave}
            disabled={save.isPending || !valid || n === saved}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <p className="text-muted">Only the team leader can change this.</p>
      )}
    </div>
  );
}

type AccessChoice<V> = { value: V; name: string; hint: string };

const HISTORY_CHOICES: AccessChoice<LootAccess['history']>[] = [
  { value: 'team', name: 'Everyone on the team', hint: 'Raiders and officers can open Loot history.' },
  { value: 'officers', name: 'Officers only', hint: 'Raiders see a note that the team keeps it to officers.' }
];

const IMPORT_CHOICES: AccessChoice<LootAccess['import']>[] = [
  { value: 'officers', name: 'Officers', hint: 'Anyone whose rank can manage loot.' },
  { value: 'leader', name: 'Team leader only', hint: 'Officers can still reassign and fix loot rows.' }
];

// Who can open Loot history and who can import RCLootCouncil exports (#1560).
// The database enforces both: team_loot_history() and the loot table's insert rule.
function LootAccessCard({ teamId, saved, canEdit }: { teamId: number; saved: LootAccess; canEdit: boolean }) {
  const { announce } = useStatus();
  const [choice, setChoice] = useState(saved);
  const save = useSaveLootAccess(teamId);
  const changed = choice.history !== saved.history || choice.import !== saved.import;

  const onSave = () =>
    save.mutate(choice, {
      onSuccess: () => announce('success', 'Saved!'),
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <div className="card settings-card">
      <h2>Access</h2>
      <p className="text-muted">
        {canEdit ? 'Takes effect as soon as you save.' : 'Only the team leader can change who has access.'}
      </p>
      <AccessGroup
        name="loot-access-history"
        title="Who can open loot history"
        choices={HISTORY_CHOICES}
        value={choice.history}
        disabled={!canEdit}
        onChange={(history) => setChoice((was) => ({ ...was, history }))}
      />
      <AccessGroup
        name="loot-access-import"
        title="Who can import RCLootCouncil exports"
        choices={IMPORT_CHOICES}
        value={choice.import}
        disabled={!canEdit}
        onChange={(value) => setChoice((was) => ({ ...was, import: value }))}
      />
      {canEdit && (
        <div className="settings-row">
          <button
            type="button"
            className="button button-primary"
            onClick={onSave}
            disabled={save.isPending || !changed}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

function AccessGroup<V extends string>({
  name,
  title,
  choices,
  value,
  disabled,
  onChange
}: {
  name: string;
  title: string;
  choices: AccessChoice<V>[];
  value: V;
  disabled: boolean;
  onChange: (value: V) => void;
}) {
  return (
    <fieldset className="loot-access-group">
      <legend>{title}</legend>
      <div className="loot-systems">
        {choices.map((c) => (
          // eslint-disable-next-line jsx-a11y/label-has-associated-control -- the text is c.name below; the rule can't see through a prop
          <label key={c.value} className="loot-system">
            <input
              type="radio"
              name={name}
              value={c.value}
              checked={value === c.value}
              disabled={disabled}
              onChange={() => onChange(c.value)}
            />
            <span className="loot-system-text">
              <strong>{c.name}</strong>
              <span className="text-muted">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LootSystemCards({ teamId, saved, canEdit }: { teamId: number; saved: LootSystem; canEdit: boolean }) {
  const { announce } = useStatus();
  const [choice, setChoice] = useState(saved);
  const save = useSaveLootSystem(teamId);

  const onSave = () =>
    save.mutate(choice, {
      onSuccess: () => announce('success', 'Saved!'),
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <>
      <div className="card settings-card" role="radiogroup" aria-labelledby="loot-system-title">
        <h2 id="loot-system-title">Loot system</h2>
        <p className="text-muted">
          {canEdit
            ? 'Switching takes effect as soon as you save. Saved priority orders are kept, so switching back brings them back.'
            : 'Only the team leader can change this.'}
        </p>
        <div className="loot-systems">
          {LOOT_SYSTEMS.map((system) => (
            <label key={system.id} className="loot-system">
              <input
                type="radio"
                name="loot-system"
                value={system.id}
                checked={choice === system.id}
                disabled={!canEdit || system.comingSoon}
                onChange={() => setChoice(system.id as LootSystem)}
              />
              <span className="loot-system-text">
                <strong>{system.name}</strong>
                <span className="text-muted">{system.description}</span>
                {system.comingSoon && <span className="loot-soon">Coming soon</span>}
              </span>
            </label>
          ))}
        </div>
        {canEdit && (
          <div className="settings-row">
            <button
              type="button"
              className="button button-primary"
              onClick={onSave}
              disabled={save.isPending || choice === saved}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {choice === 'priority' && <PriorityCard />}
      {choice === 'wishlist' && <WishlistCard />}
      {choice === 'council' && <CouncilCard />}
    </>
  );
}

// The numbers generate_priority_order() uses today. Changing them is the
// custom priority calculator (#1566), part of the team plan.
const PRIORITY_ROWS: [string, string][] = [
  ['DPS score', '50% performance · 50% attendance'],
  ['Healer and tank score', 'Attendance only'],
  ['Healers / tanks count at', '0.75× / 0.50×'],
  ['Mythic list: no copy / has Champion / has Heroic', '1.15× / 1.07× / 0.85×'],
  ['Heroic list: has Champion', '0.90×'],
  ['Tier tokens go first to raiders wearing', '1 › 0 › 3 › 2 › 4 pieces']
];

function PriorityCard() {
  return (
    <div className="card settings-card">
      <h2>How priority is worked out</h2>
      <p className="text-muted">What Suggest order uses. Only raiders who marked the item BiS are ranked.</p>
      <dl className="loot-rows">
        {PRIORITY_ROWS.map(([label, value]) => (
          <div key={label} className="loot-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="loot-locked">
        Change these numbers, or add Effort and Sim gain <span className="loot-plan">Team plan</span>
      </p>
    </div>
  );
}

function WishlistCard() {
  return (
    <div className="card settings-card">
      <h2>Wishlist</h2>
      <p className="text-muted">
        Raiders mark items BiS or Sidegrade. The Priority page lists who wants each item by mark, with their notes, and
        no ranks. In game, each candidate shows On wishlist: BiS, On wishlist: Sidegrade, or Not on wishlist.
      </p>
    </div>
  );
}

function CouncilCard() {
  return (
    <div className="card settings-card">
      <h2>Loot council</h2>
      <p className="text-muted">
        Officers decide from the rolls in game. Raiders have no wishlist, and there is no Priority page or RCLootCouncil
        string. Loot import, history and items received work as usual. Marks and orders already saved are kept and come
        back if you switch.
      </p>
    </div>
  );
}
