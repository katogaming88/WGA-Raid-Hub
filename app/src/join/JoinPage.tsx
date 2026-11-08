import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { useAccess } from '../auth/access';
import { SwitchDialog } from '../auth/ConnectPrompt';
import { BATTLENET, DISCORD, useSession } from '../auth/session';
import { useStatus } from '../components/Status';
import { CharacterIcon } from '../characters/CharacterIcon';
import { pickerRows, type AccountCharacter, type CharactersAnswer } from '../characters/characters';
import { errorMessage } from '../lib/errors';
import { refusalStatus, useBattlenetCharacters } from '../characters/useCharacters';
import { defaultGuildPath } from '../config';
import { OwnNameForm } from '../roster/OwnNameForm';
import { useClaimName, useNames } from '../roster/useNames';
import { useInviteTarget, useJoinTeam, type InviteTarget } from './useJoin';
import '../characters/characters.css';
import '../signup/signup.css';

// /join/<code> (#1264): the page an invite link opens. Team and guild name,
// Battle.net sign-in, joining, which Member is you (#1355), character pick, then onto the roster -- the
// link is the approval. A site page, so it sits in the frame of the guild last
// visited. Same character pick as Sign Up (#1162).
export function JoinPage({ code }: { code: string }) {
  const target = useInviteTarget(code);
  return (
    <DataState query={target} label="this invite link">
      {(t) => (t ? <Join code={code} target={t} /> : <DeadLink />)}
    </DataState>
  );
}

function DeadLink() {
  return (
    <section className="card signup-card">
      <h1>This link doesn’t work</h1>
      <p className="text-muted">It was reset or has expired. Ask an officer of the team for a fresh invite link.</p>
    </section>
  );
}

function Join({ code, target }: { code: string; target: InviteTarget }) {
  const { user, signIn, connect } = useSession();
  const heading = (
    <h1>
      Join {target.teamName} ({target.guildName})
    </h1>
  );
  const invited = (
    <p>
      You’ve been invited to join {target.teamName}, a raid team in {target.guildName}. No officer needs to approve you:
      you’re on the team as soon as you finish.
    </p>
  );

  if (!user) {
    return (
      <section className="card signup-card">
        {heading}
        {invited}
        <p className="text-muted">Start by signing in with Battle.net.</p>
        <button type="button" className="button button-primary" onClick={() => void signIn(BATTLENET)}>
          Sign in with Battle.net
        </button>
      </section>
    );
  }
  if (!user.hasBattlenet) {
    return (
      <section className="card signup-card">
        {heading}
        {invited}
        <p className="text-muted">Connect Battle.net so you can pick your character.</p>
        <button type="button" className="button" onClick={() => void connect(BATTLENET, 'signup-character')}>
          Connect Battle.net
        </button>
      </section>
    );
  }
  if (!user.hasDiscord) {
    // Team membership is keyed on the Discord id, so it has to be on the account.
    return (
      <section className="card signup-card">
        {heading}
        {invited}
        <p className="text-muted">Connect your Discord too: your team roles and raid notifications come from it.</p>
        <DiscordStep onConnect={() => void connect(DISCORD)} />
      </section>
    );
  }
  return (
    <section className="card signup-card">
      {heading}
      {invited}
      <Steps code={code} target={target} />
    </section>
  );
}

// Someone who already uses the site with Discord can't connect it here: that
// Discord is on their real account. They switch to it instead. A refused
// connect opens the same switch from the app frame.
function DiscordStep({ onConnect }: { onConnect: () => void }) {
  const { switchToDiscord } = useSession();
  const { announce } = useStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const onSwitch = () => {
    setBusy(true);
    switchToDiscord().catch((error: unknown) => {
      setBusy(false);
      announce('error', `Could not switch to your Discord account: ${errorMessage(error)}`);
    });
  };
  return (
    <>
      <div className="connect-actions">
        <button type="button" className="button" onClick={onConnect}>
          Connect Discord
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Already use WGA Raid Hub with Discord?
        </button>
      </div>
      {open && <SwitchDialog busy={busy} onClose={() => setOpen(false)} onSwitch={onSwitch} />}
    </>
  );
}

// Join the team, then say which Member is you (claim one an officer made, or
// make your own), then pick a character (#1355, Kat 2026-10-26).
function Steps({ code, target }: { code: string; target: InviteTarget }) {
  const access = useAccess();
  const names = useNames(target.teamId);
  const join = useJoinTeam(code);
  const [skippedMember, setSkippedMember] = useState(false);
  const membership = access.data?.teams.find((t) => t.teamId === target.teamId);
  const teamLink = `${defaultGuildPath()}/t/${target.teamSlug}`;

  if (access.isPending || names.isPending) {
    return (
      <p className="text-muted" role="status">
        Loading…
      </p>
    );
  }
  if (access.isError || names.isError) {
    return (
      <p className="form-error" role="alert">
        Could not load the team: {(access.error ?? names.error)?.message}
      </p>
    );
  }
  if (!membership) {
    return (
      <>
        {join.isError && (
          <p className="form-error" role="alert">
            Could not join: {join.error.message}
          </p>
        )}
        <button
          type="button"
          className="button button-primary"
          disabled={join.isPending}
          onClick={() => join.mutate({ blizzardId: null })}
        >
          {join.isPending ? 'Joining…' : `Join ${target.teamName}`}
        </button>
      </>
    );
  }
  const holdsName = (names.data ?? []).some((n) => n.team_member_id === membership.teamMemberId);
  if (!holdsName && !skippedMember) {
    return <MemberStep target={target} onSkip={() => setSkippedMember(true)} />;
  }
  if (membership.characters.length > 0) {
    return (
      <>
        <h2>You’re on the roster</h2>
        <p>Welcome to {target.teamName}.</p>
        <Link className="button button-primary" to={teamLink}>
          Go to {target.teamName}
        </Link>
      </>
    );
  }
  return <Picker code={code} target={target} />;
}

// Which Member is you: one an officer already made (Claim), or your own.
function MemberStep({ target, onSkip }: { target: InviteTarget; onSkip: () => void }) {
  const names = useNames(target.teamId);
  const claim = useClaimName(target.teamId);
  const { announce } = useStatus();
  const bare = (names.data ?? []).filter((n) => n.team_member_id === null);
  return (
    <>
      <h2>What should the team call you?</h2>
      {bare.length > 0 && (
        <>
          <p className="text-muted">An officer may have already added you; find your Member row below and claim it.</p>
          <ul className="join-members" tabIndex={0} aria-label="Members an officer already added">
            {bare.map((n) => (
              <li key={n.id}>
                <span>{n.label}</span>
                <button
                  type="button"
                  className="button"
                  disabled={claim.isPending}
                  onClick={() =>
                    claim.mutate({ nameId: n.id }, { onSuccess: () => announce('success', `Claimed ${n.label}.`) })
                  }
                >
                  That’s me
                </button>
              </li>
            ))}
          </ul>
          {bare.length > 5 && (
            <p className="text-muted join-members-count">
              {bare.length} Members to look through. Scroll the list to see them all before adding yourself.
            </p>
          )}
          {claim.isError && (
            <p className="form-error" role="alert">
              That did not save: {claim.error.message}
            </p>
          )}
        </>
      )}
      <OwnNameForm
        teamId={target.teamId}
        card={false}
        label={bare.length > 0 ? 'Not on the list? Add yourself to the roster' : 'Add yourself to the roster'}
      />
      <button type="button" className="button join-skip" onClick={onSkip}>
        Skip for now
      </button>
    </>
  );
}

function Picker({ code, target }: { code: string; target: InviteTarget }) {
  const { battlenetToken, refreshBattlenet } = useSession();
  const list = useBattlenetCharacters();
  // Its own mutation, so reading the list again after a refused save does not
  // leave the Join button reading "Joining…" while nothing is being joined.
  const confirm = useBattlenetCharacters();
  const join = useJoinTeam(code);
  const [answer, setAnswer] = useState<CharactersAnswer | null>(null);
  const [picked, setPicked] = useState<AccountCharacter | null>(null);
  const started = useRef<string | null>(null);
  const { mutate: read } = list;
  const load = useCallback((token: string) => read({ token, allLevels: true }, { onSuccess: setAnswer }), [read]);

  // Saving the pick is what proves it: the function saves only characters
  // Blizzard just confirmed on this account, and the join then resolves the
  // roster name from that record (#1319). Everything already saved goes back
  // with it, since the save replaces the whole set.
  const onJoin = () => {
    if (!picked || !battlenetToken || !answer) return;
    const saved = answer.characters.filter((c) => c.saved).map((c) => c.blizzard_id);
    const save = saved.includes(picked.blizzard_id) ? saved : [...saved, picked.blizzard_id];
    confirm.mutate(
      { token: battlenetToken, save, allLevels: true },
      {
        onSuccess: (result) => {
          setAnswer(result);
          join.mutate({ blizzardId: picked.blizzard_id });
        }
      }
    );
  };

  useEffect(() => {
    if (!battlenetToken || started.current === battlenetToken) return;
    started.current = battlenetToken;
    load(battlenetToken);
  }, [battlenetToken, load]);

  if (join.isSuccess) {
    return join.data === 'joined' ? (
      <>
        <h2>You’re on the roster</h2>
        <p>Welcome to {target.teamName}.</p>
        <Link className="button button-primary" to={`${defaultGuildPath()}/t/${target.teamSlug}`}>
          Go to {target.teamName}
        </Link>
      </>
    ) : (
      <>
        <h2>You’ve joined {target.teamName}</h2>
        <p>The roster is full right now, so an officer has been flagged. You’ll be added as soon as there’s room.</p>
      </>
    );
  }
  if (!battlenetToken) {
    return (
      <>
        <p className="text-muted">Battle.net needs to confirm it’s you before your characters can be read.</p>
        <button type="button" className="button" onClick={() => void refreshBattlenet('signup-character')}>
          Load your characters from Battle.net
        </button>
      </>
    );
  }
  if (list.isError && !answer) {
    return (
      <p className="form-error" role="alert">
        Could not read your characters from Battle.net: {list.error.message}
      </p>
    );
  }
  if (!answer) {
    return (
      <p className="text-muted" role="status">
        Reading your characters from Battle.net…
      </p>
    );
  }

  const rows = pickerRows(answer, new Map());
  return (
    <>
      <p className="text-muted">Last step: pick the character you’ll raid on.</p>
      {rows.length === 0 ? (
        <p className="text-muted">No characters found on this Battle.net account.</p>
      ) : (
        <div className="signup-bnet-list" role="radiogroup" aria-label="Your characters">
          {rows.map(({ character, kind }) => {
            const isPicked = picked?.blizzard_id === character.blizzard_id;
            return (
              <button
                key={character.blizzard_id}
                type="button"
                role="radio"
                aria-checked={isPicked}
                disabled={kind === 'claimed'}
                className="signup-bnet-row"
                onClick={() => setPicked(character)}
              >
                <CharacterIcon className={character.class_name} spec={character.spec_name} />
                <span className="character-text">
                  <span className="character-name">{character.name}</span>
                  <span className="character-sub">
                    {character.realm}
                    {character.class_name && ` · ${character.class_name}`}
                    {character.spec_name ? ` (${character.spec_name})` : ` · Level ${character.level}`}
                  </span>
                </span>
                {kind === 'claimed' && <span className="status-tag character-tag">Claimed by another player</span>}
              </button>
            );
          })}
        </div>
      )}
      {join.isError && (
        <p className="form-error" role="alert">
          Could not join: {join.error.message}
        </p>
      )}
      {confirm.isError && (
        <>
          <p className="form-error" role="alert">
            Battle.net could not confirm that character: {confirm.error.message}
          </p>
          {refusalStatus(confirm.error) === 401 && (
            <button type="button" className="button" onClick={() => void refreshBattlenet('signup-character')}>
              Sign in with Battle.net again
            </button>
          )}
        </>
      )}
      <button
        type="button"
        className="button button-primary"
        disabled={!picked || join.isPending || confirm.isPending}
        onClick={onJoin}
      >
        {join.isPending || confirm.isPending ? 'Joining…' : `Join ${target.teamName}`}
      </button>
    </>
  );
}
