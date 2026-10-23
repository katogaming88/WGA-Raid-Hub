import { useId, useState } from 'react';
import { Link } from 'react-router';
import { can, useAccess } from '../auth/access';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { easternToday, isoDateLong } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import {
  SKIP_REASONS,
  canClose,
  closeOpensOn,
  defaultSeason,
  hasStarted,
  type PromotionEntry,
  type PromotionPreview,
  type SignupSeason
} from './signups';
import { useCloseSignups, useOpenSignups, usePromotionPreview, useSignupSettings } from './useSignupSettings';
import './settings.css';

// Settings > Signups (#1342): the team leader opens signups for a season and
// closes them, which puts everyone who signed up on the roster (#1467).
// Officers see the page read-only; open and close are the team leader's, as
// set_team_season() and promote_season_signups() check.
export function SignupSettingsPage() {
  const team = useTeam();
  const query = useSignupSettings(team.id);
  const access = useAccess();
  const canEdit = can(access.data, 'leadTeam', team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Signup settings</h1>
      </div>
      <DataState query={query} label="signup settings">
        {(seasons) => <SignupsCard teamId={team.id} seasons={seasons} canEdit={canEdit} />}
      </DataState>
    </section>
  );
}

function SignupsCard({ teamId, seasons, canEdit }: { teamId: number; seasons: SignupSeason[]; canEdit: boolean }) {
  const id = useId();
  const [code, setCode] = useState(() => defaultSeason(seasons)?.code ?? '');
  const [closing, setClosing] = useState(false);
  const open = useOpenSignups(teamId);
  const { announce } = useStatus();
  const season = seasons.find((s) => s.code === code) ?? defaultSeason(seasons);
  const today = easternToday();

  if (!season) {
    return (
      <div className="card settings-card">
        <h2>Signups</h2>
        <p className="text-muted">No coming season is on file yet.</p>
      </div>
    );
  }

  const onOpen = () =>
    open.mutate(
      { season: season.code },
      {
        onSuccess: () => announce('success', `Signups for ${season.name} are open.`),
        onError: (error) => announce('error', errorMessage(error))
      }
    );

  return (
    <div className="card settings-card signup-settings-card">
      <h2>Signups</h2>
      <p className="text-muted">
        Raiders sign up for a season on the Sign up page, and everyone who has signed up shows on the{' '}
        <Link to="../../../roster" relative="path">
          Roster’s Projected Roster
        </Link>
        . Closing signups puts them on the roster.
      </p>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-season`}>
          Season
        </label>
        {/* The state sits beside the dropdown, centred on it, not on the
            label above. */}
        <div className="signup-settings-row">
          <select id={`${id}-season`} className="input" value={season.code} onChange={(e) => setCode(e.target.value)}>
            {seasons.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <span className={`signup-state ${season.open ? 'signup-state-open' : ''}`}>
            {season.open ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>
      <p className="text-muted">
        {hasStarted(season, today)
          ? `${season.name} started ${isoDateLong(season.startsAt)}.`
          : `${season.name} starts ${isoDateLong(season.startsAt)}.`}
      </p>
      {!canEdit ? (
        <p className="text-muted">Only the team leader can open or close signups.</p>
      ) : season.open ? (
        <>
          <button
            type="button"
            className="button button-primary"
            disabled={!canClose(season, today)}
            onClick={() => setClosing(true)}
          >
            Close signups…
          </button>
          {!canClose(season, today) && (
            <p className="text-muted">
              You can close signups from {isoDateLong(closeOpensOn(season))}, two weeks before the season starts.
            </p>
          )}
        </>
      ) : hasStarted(season, today) ? (
        <p className="text-muted">This season has started, so it takes no new signups.</p>
      ) : (
        <button type="button" className="button button-primary" disabled={open.isPending} onClick={onOpen}>
          {open.isPending ? 'Opening…' : 'Open signups'}
        </button>
      )}
      {closing && <CloseSignupsDialog teamId={teamId} season={season} onClose={() => setClosing(false)} />}
    </div>
  );
}

// The confirm (#1467): what closing will do, by name, with a Keep tick for
// each raider nobody signed up for. Everyone is ticked to come off; the
// leader unticks anyone who stays.
function CloseSignupsDialog({
  teamId,
  season,
  onClose
}: {
  teamId: number;
  season: SignupSeason;
  onClose: () => void;
}) {
  const preview = usePromotionPreview(teamId, season.code);
  const close = useCloseSignups(teamId);
  return (
    <Dialog title={`Close signups for ${season.name}`} onClose={onClose} busy={close.isPending} wide>
      <DataState query={preview} label="what closing signups will do">
        {(p) => (
          <CloseSignupsBody
            key={p.expected}
            season={season}
            preview={p}
            close={close}
            onReread={() => void preview.refetch()}
            onClose={onClose}
          />
        )}
      </DataState>
    </Dialog>
  );
}

function CloseSignupsBody({
  season,
  preview,
  close,
  onReread,
  onClose
}: {
  season: SignupSeason;
  preview: PromotionPreview;
  close: ReturnType<typeof useCloseSignups>;
  onReread: () => void;
  onClose: () => void;
}) {
  const [keep, setKeep] = useState<Set<number>>(() => new Set());
  const { announce } = useStatus();
  const archive = preview.archives.map((a) => a.player_id!).filter((pid) => !keep.has(pid));

  const toggle = (playerId: number) =>
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });

  const onConfirm = () =>
    close.mutate(
      { season: season.code, expected: preview.expected, archive },
      {
        onSuccess: () => {
          announce('success', `Signups for ${season.name} are closed and the roster is updated.`);
          onClose();
        }
      }
    );

  const adding = preview.joins.length + preview.first_mains.length + preview.swaps.length;

  return (
    <div className="close-signups">
      <p>
        {adding === 0 && preview.stays.length === 0
          ? 'Nobody has signed up yet.'
          : `${adding} ${adding === 1 ? 'raider joins' : 'raiders join'} or ${adding === 1 ? 'changes' : 'change'} character, and ${preview.stays.length} ${preview.stays.length === 1 ? 'stays' : 'stay'} as they are.`}
      </p>
      <EntryList title="Joining the team" entries={preview.joins} />
      <EntryList title="First character on the team" entries={preview.first_mains} />
      <EntryList
        title="Changing character"
        entries={preview.swaps}
        line={(e) => `${e.name_realm}, replacing ${e.from_name_realm}`}
      />
      <EntryList
        title="Left as they are, for you to settle"
        entries={preview.skipped}
        line={(e) => `${e.name_realm}: ${e.reason ? SKIP_REASONS[e.reason] : ''}`}
      />
      {preview.archives.length > 0 && (
        <fieldset className="close-signups-archive">
          <legend>Did not sign up</legend>
          <p className="text-muted">
            Ticked characters come off the roster as “Did not sign up”. Untick anyone who stays. They stay on the team
            either way.
          </p>
          <ul className="close-signups-list">
            {preview.archives.map((a) => (
              <li key={a.player_id}>
                <label>
                  <input type="checkbox" checked={!keep.has(a.player_id!)} onChange={() => toggle(a.player_id!)} />{' '}
                  {a.name_realm}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {close.isError && (
        <div className="form-error" role="alert">
          <p>{errorMessage(close.error)}</p>
          {/* A signup or a removal since the preview was read: read it again
              rather than guess what changed. */}
          <button
            type="button"
            className="button"
            onClick={() => {
              close.reset();
              onReread();
            }}
          >
            Read it again
          </button>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose} disabled={close.isPending}>
          Cancel
        </button>
        <button type="button" className="button button-primary" onClick={onConfirm} disabled={close.isPending}>
          {close.isPending
            ? 'Closing…'
            : archive.length
              ? `Close signups and take ${archive.length} off`
              : 'Close signups'}
        </button>
      </div>
    </div>
  );
}

function EntryList({
  title,
  entries,
  line = (e) => e.name_realm
}: {
  title: string;
  entries: PromotionEntry[];
  line?: (e: PromotionEntry) => string;
}) {
  if (!entries.length) return null;
  return (
    <section>
      <h3 className="close-signups-title">
        {title} <span className="num">({entries.length})</span>
      </h3>
      <ul className="close-signups-list">
        {entries.map((e) => (
          <li key={`${e.signup_id ?? ''}-${e.player_id ?? ''}`}>{line(e)}</li>
        ))}
      </ul>
    </section>
  );
}
