import { useState } from 'react';
import { usePageCan } from '../auth/access';
import { useTeam } from '../data/address';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { InviteLinkSection } from '../invite/InviteLinkPage';
import { RanksSection } from './RanksSettingsPage';
import { clampInt } from './settings';
import {
  useGeneralSettings,
  useSaveRosterTargets,
  useSaveSeasonView,
  useSaveTrialThresholds,
  useSaveWclUrl,
  type GeneralSettings
} from './useSettings';
import './settings.css';

// Settings > General (#1357, #1735): the team's setup on one page. The basics
// (Warcraft Logs page, roster sizes, trial thresholds) for whoever can manage
// the team, the invite link for whoever can edit the roster, and the ranks for
// whoever can promote assistants; each section shows only to them. Season View
// moved to Settings > Season (#1735), the Discord signup sheet to Discord (#994).
export function GeneralSettingsPage() {
  const team = useTeam();
  const { can } = usePageCan();

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">General settings</h1>
      </div>
      {can('manageTeam') && <TeamBasics teamId={team.id} />}
      {can('editRoster') && <InviteLinkSection />}
      {can('promoteAssistants') && <RanksSection />}
    </section>
  );
}

function TeamBasics({ teamId }: { teamId: number }) {
  const query = useGeneralSettings(teamId);
  return (
    <DataState query={query} label="settings">
      {(settings) => (
        <div className="settings-cards">
          <WclUrlCard teamId={teamId} settings={settings} />
          <RosterTargetsCard teamId={teamId} settings={settings} />
          <TrialThresholdsCard teamId={teamId} settings={settings} />
        </div>
      )}
    </DataState>
  );
}

export function SeasonViewCard({
  teamId,
  settings,
  options
}: {
  teamId: number;
  settings: GeneralSettings;
  options: string[];
}) {
  const { announce } = useStatus();
  const [value, setValue] = useState(settings.seasonView ?? '');
  const save = useSaveSeasonView(teamId);

  const onSave = () =>
    save.mutate(value || null, {
      onSuccess: () => announce('success', value ? 'Saved!' : 'Cleared.'),
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <div className="card settings-card">
      <h2>Season View</h2>
      <p className="text-muted">
        The season your team is planning items/BiS/Wishlist for. Leave on Live season and the Priority tab, BiS Lists,
        and Wishlist reflect the current raiding season automatically. This does not affect signups.
      </p>
      <div className="settings-row">
        <label className="visually-hidden" htmlFor="season-view-select">
          Season view
        </label>
        <select id="season-view-select" className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Live season (current)</option>
          {options.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <button type="button" className="button button-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function TrialThresholdsCard({ teamId, settings }: { teamId: number; settings: GeneralSettings }) {
  const { announce } = useStatus();
  const [weeks, setWeeks] = useState(String(settings.trialWeeks));
  const [attend, setAttend] = useState(String(settings.trialAttend));
  const save = useSaveTrialThresholds(teamId);

  const onSave = () => {
    const w = clampInt(Number(weeks) || 4, 1, 52);
    const a = clampInt(Number(attend) || 75, 0, 100);
    setWeeks(String(w));
    setAttend(String(a));
    save.mutate(
      { weeks: w, attend: a },
      { onSuccess: () => announce('success', 'Saved!'), onError: (error) => announce('error', errorMessage(error)) }
    );
  };

  return (
    <div className="card settings-card">
      <h2>Trial Promotion Thresholds</h2>
      <p className="text-muted">A trial player appears in the promotion alert once they meet both thresholds.</p>
      <div className="settings-row">
        <span className="text-muted">At least</span>
        <label className="visually-hidden" htmlFor="trial-weeks-input">
          Weeks on roster
        </label>
        <input
          id="trial-weeks-input"
          type="number"
          className="input settings-number"
          min={1}
          max={52}
          value={weeks}
          onChange={(e) => setWeeks(e.target.value)}
        />
        <span className="text-muted">weeks on roster and</span>
        <label className="visually-hidden" htmlFor="trial-attend-input">
          Percent attendance
        </label>
        <input
          id="trial-attend-input"
          type="number"
          className="input settings-number"
          min={0}
          max={100}
          value={attend}
          onChange={(e) => setAttend(e.target.value)}
        />
        <span className="text-muted">% attendance</span>
        <button type="button" className="button button-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function RosterTargetsCard({ teamId, settings }: { teamId: number; settings: GeneralSettings }) {
  const { announce } = useStatus();
  const [tank, setTank] = useState(settings.targetTankCount == null ? '' : String(settings.targetTankCount));
  const [heal, setHeal] = useState(settings.targetHealCount == null ? '' : String(settings.targetHealCount));
  const save = useSaveRosterTargets(teamId);

  const onSave = () => {
    const tankParsed = tank.trim() === '' ? null : clampInt(Number(tank), 0, 20);
    const healParsed = heal.trim() === '' ? null : clampInt(Number(heal), 0, 20);
    save.mutate(
      { tank: tankParsed, heal: healParsed },
      { onSuccess: () => announce('success', 'Saved!'), onError: (error) => announce('error', errorMessage(error)) }
    );
  };

  return (
    <div className="card settings-card">
      <h2>Target Roster Sizes</h2>
      <p className="text-muted">
        Shown to raiders signing up as Tank or Healer: once the roster meets or exceeds a target, they see a nudge to
        consider DPS/backup instead. Leave a field blank to skip the nudge for that role.
      </p>
      <div className="settings-row">
        <label className="text-muted" htmlFor="target-tank-input">
          Tanks
        </label>
        <input
          id="target-tank-input"
          type="number"
          className="input settings-number"
          min={0}
          max={20}
          value={tank}
          onChange={(e) => setTank(e.target.value)}
        />
        <label className="text-muted" htmlFor="target-heal-input">
          Healers
        </label>
        <input
          id="target-heal-input"
          type="number"
          className="input settings-number"
          min={0}
          max={20}
          value={heal}
          onChange={(e) => setHeal(e.target.value)}
        />
        <button type="button" className="button button-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function WclUrlCard({ teamId, settings }: { teamId: number; settings: GeneralSettings }) {
  const { announce } = useStatus();
  const [url, setUrl] = useState(settings.warcraftLogsUrl);
  const save = useSaveWclUrl(teamId);

  const onSave = () => {
    const trimmed = url.trim();
    setUrl(trimmed);
    save.mutate(trimmed, {
      onSuccess: () => announce('success', trimmed ? 'Saved!' : 'Cleared.'),
      onError: (error) => announce('error', errorMessage(error))
    });
  };

  return (
    <div className="card settings-card">
      <h2>WarcraftLogs Guild URL</h2>
      <p className="text-muted">
        This team's own WarcraftLogs guild page. Shown as the WCL icon in the header once set. Leave blank to hide it.
      </p>
      <div className="settings-row">
        <label className="visually-hidden" htmlFor="wcl-url-input">
          WarcraftLogs guild URL
        </label>
        <input
          id="wcl-url-input"
          type="text"
          className="input settings-url"
          placeholder="https://www.warcraftlogs.com/guild/id/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="button" className="button button-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
