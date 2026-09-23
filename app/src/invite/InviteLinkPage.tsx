import { useId, useState, type FormEvent } from 'react';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { useInviteLink, useResetInviteLink, type InviteLink } from './useInviteLink';
import './invite-link.css';

// The officer invite-link panel (#1264 step 2): copy the team's link, set how
// long it lasts, or reset it. The /join/<code> page it points to is a later
// PR -- resetting works today even though nothing resolves the link yet.

// No "no expiry" option (Kat, 2026-09-22): every link has to run out eventually.
const DURATIONS = [
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '6 months', days: 182 },
  { label: '1 year', days: 365 }
] as const;

function joinUrl(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return 'No expiry';
  const date = new Date(expiresAt);
  const formatted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
  return date.getTime() < Date.now() ? `Expired ${formatted}` : `Expires ${formatted}`;
}

export function InviteLinkPage() {
  const team = useTeam();
  const link = useInviteLink(team.id);

  return (
    <section className="page invite-link-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Invite link</h1>
        <p className="text-muted page-subtitle">
          Share this link so a raider can join {team.name} straight from it -- no approval needed, since opening the
          link is the approval. Resetting it stops the old one working immediately.
        </p>
      </div>
      <DataState query={link} label="the invite link">
        {(current) => <InviteLinkCard teamId={team.id} teamName={team.name} current={current} />}
      </DataState>
    </section>
  );
}

function InviteLinkCard({
  teamId,
  teamName,
  current
}: {
  teamId: number;
  teamName: string;
  current: InviteLink | null;
}) {
  const id = useId();
  const { announce } = useStatus();
  const [days, setDays] = useState<number>(30);
  const [copied, setCopied] = useState(false);
  const reset = useResetInviteLink(teamId);

  const onCopy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(joinUrl(current.code));
    setCopied(true);
    announce('success', 'Copied the invite link.');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    reset.mutate(
      { expiresAt },
      {
        onSuccess: () => {
          setCopied(false);
          announce('success', current ? 'Invite link reset. The old one no longer works.' : 'Invite link generated.');
        }
      }
    );
  };

  return (
    <div className="card invite-link-card">
      {current ? (
        <div className="invite-link-current">
          <label className="field-label" htmlFor={`${id}-url`}>
            Current link
          </label>
          <div className="invite-link-row">
            <input id={`${id}-url`} className="input" type="text" readOnly value={joinUrl(current.code)} />
            <button type="button" className="button" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-muted invite-link-expiry">{expiryLabel(current.expiresAt)}</p>
        </div>
      ) : (
        <p className="text-muted">{teamName} has no invite link yet.</p>
      )}

      <form onSubmit={onSubmit} noValidate className="invite-link-form">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-expiry`}>
            {current ? 'Reset with a new link that lasts' : 'Generate a link that lasts'}
          </label>
          <select
            id={`${id}-expiry`}
            className="input"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DURATIONS.map((d) => (
              <option key={d.label} value={d.days}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        {reset.isError && (
          <p className="form-error" role="alert">
            That did not save: {reset.error.message}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={reset.isPending}>
          {reset.isPending ? 'Saving…' : current ? 'Reset link' : 'Generate link'}
        </button>
      </form>
    </div>
  );
}
