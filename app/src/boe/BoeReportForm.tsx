import { useId, useState } from 'react';
import { useAccess } from '../auth/access';
import { useSeasons } from '../calendar/useCalendar';
import { useAddress } from '../data/address';
import { currentSeason } from '../profile/profile';
import { useRaidZones } from '../profile/useProfile';
import { boeFieldError, boeSeasonCatalog, defaultBoeTeamId, EMPTY_BOE_FIELDS, RANKS, TRACKS } from './boe';
import { useBoeCatalog, useSubmitBoeFound } from './useBoe';

// The "Report a find" card (#1304, ported from js/boe.js): open to anyone,
// signed in or not, at the guild-wide /g/:guildKey/boe page. Fields and
// validation order match tests/frontend/boe-submit.test.js.
export function BoeReportForm() {
  const { teams } = useAddress();
  const listed = teams.filter((t) => !t.archived);
  const access = useAccess();
  const catalog = useBoeCatalog();
  const seasons = useSeasons();
  const zones = useRaidZones();
  const submit = useSubmitBoeFound();
  const id = useId();

  const [picked, setPicked] = useState(EMPTY_BOE_FIELDS);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Exactly one claimed team is the only case where a guess beats asking
  // (#891): alts on several teams could be raiding with any of them tonight.
  // Derived every render rather than copied into state, so a visitor's own
  // pick (once made) is never clobbered by a slower access read landing
  // after theirs.
  const claims = access.data?.teams.filter((t) => t.characters.length > 0) ?? [];
  const autoTeamId = defaultBoeTeamId(claims.map((t) => t.teamId));
  const autoCharName = claims[0]?.characters[0]?.nameRealm ?? '';
  const fields = {
    ...picked,
    teamId: picked.teamId ?? autoTeamId,
    charName: picked.charName || autoCharName
  };

  const entries = boeSeasonCatalog(
    catalog.data ?? [],
    currentSeason(seasons.data ?? [])?.code ?? null,
    zones.data ?? []
  );

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    setDone(null);
    const error = boeFieldError(fields);
    if (error) return;
    submit.mutate(
      {
        teamId: fields.teamId!,
        nameRealm: fields.charName.trim(),
        itemName: fields.itemName.trim(),
        track: fields.track,
        rank: fields.rank,
        note: fields.note.trim() || null,
        donate: fields.donate
      },
      {
        onSuccess: () => {
          // The team stays: a raider reporting two finds from one night is
          // reporting them for the same team.
          setPicked({ ...EMPTY_BOE_FIELDS, teamId: fields.teamId, charName: fields.charName });
          setTried(false);
          setDone('Submitted! Officers will take it from here.');
        }
      }
    );
  };

  const error = tried ? boeFieldError(fields) : null;

  return (
    <form className="card boe-report-form" onSubmit={onSubmit} noValidate>
      <p className="text-muted">
        Report here before depositing it in the guild bank. Once it's in the bank, it shows a base item level with no
        track or upgrade rank, so fill this out first while it's still on your character.
      </p>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-team`}>
          Reporting for team
        </label>
        <select
          id={`${id}-team`}
          className="select"
          value={fields.teamId ?? ''}
          aria-invalid={tried && !fields.teamId}
          onChange={(e) => setPicked((f) => ({ ...f, teamId: e.target.value ? Number(e.target.value) : null }))}
        >
          <option value="">Select the team you raided with</option>
          {listed.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-char`}>
          Character (Name-Realm)
        </label>
        <input
          id={`${id}-char`}
          className="input"
          type="text"
          autoComplete="off"
          value={fields.charName}
          aria-invalid={tried && !fields.charName.trim()}
          onChange={(e) => setPicked((f) => ({ ...f, charName: e.target.value }))}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-item`}>
          Item
        </label>
        <select
          id={`${id}-item`}
          className="select"
          value={fields.itemName}
          aria-invalid={tried && !fields.itemName.trim()}
          onChange={(e) => setPicked((f) => ({ ...f, itemName: e.target.value }))}
        >
          <option value="">Select item</option>
          {entries.map((it) => (
            <option key={it.id} value={it.name}>
              {it.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-track`}>
          Track
        </label>
        <select
          id={`${id}-track`}
          className="select"
          value={fields.track}
          aria-invalid={tried && !fields.track}
          onChange={(e) => setPicked((f) => ({ ...f, track: e.target.value }))}
        >
          <option value="">Select track</option>
          {TRACKS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-rank`}>
          Upgrade rank
        </label>
        <select
          id={`${id}-rank`}
          className="select"
          value={fields.rank}
          aria-invalid={tried && !fields.rank}
          onChange={(e) => setPicked((f) => ({ ...f, rank: e.target.value }))}
        >
          <option value="">Select upgrade rank</option>
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-note`}>
          Note (optional)
        </label>
        <textarea
          id={`${id}-note`}
          className="textarea"
          rows={3}
          value={fields.note}
          onChange={(e) => setPicked((f) => ({ ...f, note: e.target.value }))}
        />
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={fields.donate}
          onChange={(e) => setPicked((f) => ({ ...f, donate: e.target.checked }))}
        />
        <span>I'd like to donate my finder's fee to the guild</span>
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {submit.isError && (
        <p className="form-error" role="alert">
          {submit.error.message}
        </p>
      )}
      {done && (
        <p className="text-muted" role="status">
          {done}
        </p>
      )}

      <button type="submit" className="button button-primary" disabled={submit.isPending}>
        {submit.isPending ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}
