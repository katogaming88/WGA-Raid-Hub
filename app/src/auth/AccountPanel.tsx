import { useState } from 'react';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { can, charactersOn, teamRole, useAccess } from './access';
import { BATTLENET, DISCORD, useSession, type Provider } from './session';
import './auth.css';

const ROLE_LABEL = { raider: 'Raider', officer: 'Officer', team_leader: 'Team leader' } as const;

// The bottom of the sidebar: sign-in buttons when signed out, and who is
// signed in, with their role on this team, when signed in.
export function AccountPanel({ teamId }: { teamId: number | null }) {
  const { user, signIn, signOut } = useSession();
  const access = useAccess();
  const { announce } = useStatus();
  const [busy, setBusy] = useState(false);

  const start = async (provider: Provider) => {
    setBusy(true);
    try {
      await signIn(provider);
    } catch (error) {
      setBusy(false);
      announce('error', `Could not start sign-in: ${errorMessage(error)}`);
    }
  };

  if (!user) {
    return (
      <div className="signed-in account-panel">
        <button type="button" className="button account-signin" disabled={busy} onClick={() => void start(BATTLENET)}>
          Sign in with Battle.net
        </button>
        <button type="button" className="link-button" disabled={busy} onClick={() => void start(DISCORD)}>
          Sign in with Discord
        </button>
      </div>
    );
  }

  const role = access.data ? teamRole(access.data, teamId) : null;
  const main = charactersOn(access.data, teamId)[0];
  let detail: string;
  if (access.isPending) detail = 'Loading your access…';
  else if (access.isError) detail = 'Could not load your access';
  else if (role) detail = ROLE_LABEL[role] + (main ? ` · ${main.nameRealm.split('-')[0]}` : '');
  else if (can(access.data, 'adminSite')) detail = 'Site admin';
  else if (can(access.data, 'viewOfficerTools', teamId)) detail = 'Guild officer';
  else detail = user.battleTag ?? 'Not on this team';

  return (
    <div className="signed-in account-panel">
      <div className="account-who">
        {user.avatarUrl ? (
          <img className="avatar" src={user.avatarUrl} alt="" width={28} height={28} />
        ) : (
          <span className="avatar" aria-hidden="true" />
        )}
        <span className="account-text">
          <span className="account-name">{user.name}</span>
          <span className="account-detail text-muted">{detail}</span>
        </span>
      </div>
      {access.isError && (
        <button type="button" className="link-button" onClick={() => void access.refetch()}>
          Retry loading access
        </button>
      )}
      <button
        type="button"
        className="link-button"
        onClick={() =>
          void signOut().catch((error: unknown) => announce('error', `Could not sign out: ${errorMessage(error)}`))
        }
      >
        Sign out
      </button>
    </div>
  );
}
