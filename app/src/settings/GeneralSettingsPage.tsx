import { useState } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { clampInt } from './settings';
import {
  useGeneralSettings,
  useSaveDiscordSignupSheet,
  useSaveRosterTargets,
  useSaveSeasonView,
  useSaveTrialThresholds,
  useSaveWclUrl,
  useSeasonViewOptions,
  useVerifyDiscordChannel,
  type GeneralSettings
} from './useSettings';
import './settings.css';

// The officer dashboard's General settings (#1357, #1103 row 1), ported from
// tab-season.js's Settings sub-tab: five independent cards, each its own Save.
export function GeneralSettingsPage() {
  const team = useTeam();
  const page = bothQueries(useGeneralSettings(team.id), useSeasonViewOptions());

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">General settings</h1>
      </div>
      <DataState query={page} label="settings">
        {([settings, seasonOptions]) => (
          <div className="settings-cards">
            <SeasonViewCard teamId={team.id} settings={settings} options={seasonOptions} />
            <TrialThresholdsCard teamId={team.id} settings={settings} />
            <RosterTargetsCard teamId={team.id} settings={settings} />
            <WclUrlCard teamId={team.id} settings={settings} />
            <DiscordSignupSheetCard teamId={team.id} teamSlug={team.key} settings={settings} />
          </div>
        )}
      </DataState>
    </section>
  );
}

function SeasonViewCard({
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
        The season your team is planning items/BiS/Wishlist for. Leave on Live season and the Priority tab, BiS
        Lists, and Wishlist reflect the current raiding season automatically. This does not affect signups.
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
        Shown to raiders signing up as Tank or Healer: once the roster meets or exceeds a target, they see a nudge
        to consider DPS/backup instead. Leave a field blank to skip the nudge for that role.
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
        This team's own WarcraftLogs guild page. Shown as the WCL icon in the header once set. Leave blank to hide
        it.
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

function DiscordSignupSheetCard({
  teamId,
  teamSlug,
  settings
}: {
  teamId: number;
  teamSlug: string;
  settings: GeneralSettings;
}) {
  const { announce } = useStatus();
  const [channelId, setChannelId] = useState(settings.discordSignupChannelId ?? '');
  const [leadHours, setLeadHours] = useState(
    settings.signupSheetLeadHours == null ? '' : String(settings.signupSheetLeadHours)
  );
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useSaveDiscordSignupSheet(teamId);
  const verify = useVerifyDiscordChannel(teamSlug);

  const onVerify = () => {
    const trimmed = channelId.trim();
    if (!trimmed) {
      setVerifyResult({ ok: false, text: 'Enter a channel ID first.' });
      return;
    }
    verify.mutate(trimmed, {
      onSuccess: (result) =>
        setVerifyResult(result.ok ? { ok: true, text: `#${result.name}` } : { ok: false, text: result.error }),
      onError: (error) => setVerifyResult({ ok: false, text: errorMessage(error) })
    });
  };

  const onSave = () => {
    const trimmedChannel = channelId.trim();
    const hours = leadHours.trim() === '' ? null : Number(leadHours);
    save.mutate(
      { channelId: trimmedChannel || null, leadHours: hours },
      { onSuccess: () => announce('success', 'Saved!'), onError: (error) => announce('error', errorMessage(error)) }
    );
  };

  return (
    <div className="card settings-card">
      <h2>Discord Signup Sheet</h2>
      <p className="text-muted">
        The bot posts one message per raid night showing the whole roster's RSVP status. Channel ID: leave blank to
        use the bot's default attendance channel. Lead Time: how many hours before the raid the sheet gets posted
        (default 48). Use Verify to confirm a channel ID resolves to the channel you expect.
      </p>
      <div className="settings-row">
        <label className="visually-hidden" htmlFor="discord-channel-input">
          Discord channel ID
        </label>
        <input
          id="discord-channel-input"
          type="text"
          className="input settings-channel"
          placeholder="Discord channel ID"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
        />
        <button type="button" className="button" onClick={onVerify} disabled={verify.isPending}>
          {verify.isPending ? 'Checking…' : 'Verify'}
        </button>
        {verifyResult && (
          <span className={verifyResult.ok ? 'settings-verify-ok' : 'settings-verify-error'}>{verifyResult.text}</span>
        )}
      </div>
      <div className="settings-row">
        <label htmlFor="discord-lead-hours-input">Lead time (hours)</label>
        <input
          id="discord-lead-hours-input"
          type="number"
          className="input settings-number"
          min={1}
          max={336}
          placeholder="48"
          value={leadHours}
          onChange={(e) => setLeadHours(e.target.value)}
        />
        <button type="button" className="button button-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
