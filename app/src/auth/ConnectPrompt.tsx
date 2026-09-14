import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { BATTLENET, DISCORD, isAlreadyLinked, useSession } from './session';
import './auth.css';

// Keeps each account holding both logins (#1101 part 3):
// - Battle.net only: connect Discord, since roles are keyed on it. Or, for
//   someone who already uses the site with Discord, switch to that account.
// - Discord only: connect Battle.net, which the new site signs in with.
//
// Also says how a round trip to Battle.net or Discord went, once, when the
// person comes back.
export function ConnectPrompt() {
  const { user, authReturn, clearAuthReturn, connect, switchToDiscord } = useSession();
  const { announce } = useStatus();
  const [busy, setBusy] = useState(false);
  // Opens straight away when connecting Discord was refused because that
  // Discord already has an account: the switch is the way out.
  const [offerSwitch, setOfferSwitch] = useState(
    () => authReturn.intent === 'connect-discord' && isAlreadyLinked(authReturn.error)
  );
  const handled = useRef(false);

  // Once per page load: report the round trip, and finish a switch to Discord
  // by connecting Battle.net to the account it landed on.
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const { intent, error } = authReturn;
    if (!intent && !error) return;
    clearAuthReturn();

    if (error) {
      if (intent === 'connect-discord' && isAlreadyLinked(error)) {
        // The switch dialog opened with the first render.
      } else if (intent === 'connect-battlenet' && isAlreadyLinked(error)) {
        announce(
          'error',
          'That Battle.net account is already connected to a different login on WGA Raid Hub, so it was not added to this one. Ask a site admin if it needs to move.'
        );
      } else {
        announce('error', `Sign-in did not finish: ${error}`);
      }
      return;
    }
    if (intent === 'switch-to-discord' && user && !user.hasBattlenet) {
      announce('progress', 'Signed in with Discord. Connecting Battle.net…');
      void connect(BATTLENET).catch((e: unknown) =>
        announce('error', `Could not connect Battle.net: ${errorMessage(e)}`)
      );
      return;
    }
    if (intent === 'connect-discord' && user?.hasDiscord) announce('success', 'Discord connected.');
    if (intent === 'connect-battlenet' && user?.hasBattlenet) announce('success', 'Battle.net connected.');
  }, [authReturn, clearAuthReturn, connect, announce, user]);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setBusy(false);
      announce('error', `${failure}: ${errorMessage(error)}`);
    }
  };

  const switchDialog = offerSwitch && (
    <SwitchDialog
      busy={busy}
      onClose={() => setOfferSwitch(false)}
      onSwitch={() => void run(switchToDiscord, 'Could not switch to your Discord account')}
    />
  );

  if (!user || (user.hasBattlenet && user.hasDiscord)) return switchDialog || null;

  if (!user.hasDiscord) {
    return (
      <>
        <section className="card connect-card" aria-labelledby="connect-discord-title">
          <h2 id="connect-discord-title" className="connect-title">
            Connect your Discord
          </h2>
          <p>
            Your team roles and raid notifications come from Discord. Connect the Discord account you use in the guild
            to finish setting up.
          </p>
          <div className="connect-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void run(() => connect(DISCORD), 'Could not connect Discord')}
            >
              Connect Discord
            </button>
            <button type="button" className="link-button" disabled={busy} onClick={() => setOfferSwitch(true)}>
              Already use WGA Raid Hub with Discord?
            </button>
          </div>
        </section>
        {switchDialog}
      </>
    );
  }

  return (
    <section className="card connect-card" aria-labelledby="connect-battlenet-title">
      <h2 id="connect-battlenet-title" className="connect-title">
        Connect Battle.net
      </h2>
      <p>The new WGA Raid Hub signs in with Battle.net. Connect it once, and either login opens this account.</p>
      <div className="connect-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void run(() => connect(BATTLENET), 'Could not connect Battle.net')}
        >
          Connect Battle.net
        </button>
      </div>
    </section>
  );
}

function SwitchDialog({ busy, onClose, onSwitch }: { busy: boolean; onClose: () => void; onSwitch: () => void }) {
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <Dialog title="Use your Discord account" onClose={onClose} busy={busy} initialFocus={confirm}>
      <p>
        If you already use WGA Raid Hub with Discord, your roles and characters are on that account. This Battle.net
        sign-in made a new, empty one.
      </p>
      <p>
        Switching removes the empty account, signs you in with Discord, and connects Battle.net there, so either login
        opens your real account from then on.
      </p>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button ref={confirm} type="button" className="button button-primary" onClick={onSwitch} disabled={busy}>
          {busy ? 'Switching…' : 'Switch to my Discord account'}
        </button>
      </div>
    </Dialog>
  );
}
