import { useState } from 'react';
import { useTeam } from '../data/address';
import { can, useAccess } from '../auth/access';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { LOOT_SYSTEMS, type LootSystem } from './settings';
import { useLootResponses, useLootSettings, useSaveLootSystem } from './useSettings';
import { LootReceivedCard } from './LootReceivedCard';
import './settings.css';

// Settings > Loot (#1560): the team leader picks how the team hands out loot;
// officers see the page read-only. set_team_setting is team-leader/site-admin
// only by RLS, so hiding Save from an officer only saves them a refusal.
// What gets counted as loot received (#1561) is officer-run, so it has its
// own card and save. Bosses in reach (#1562) and the access card come later.
export function LootSettingsPage() {
  const team = useTeam();
  const query = useLootSettings(team.id);
  const access = useAccess();
  const canEdit = can(access.data, 'leadTeam', team.id);
  const responses = useLootResponses(team.id);

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
              canEdit={can(access.data, 'actAsOfficer', team.id)}
            />
          )}
        </DataState>
      </div>
    </section>
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
