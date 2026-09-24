import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { BATTLENET, DISCORD, useSession } from '../auth/session';
import { CharacterIcon } from '../characters/CharacterIcon';
import { pickerRows, type AccountCharacter, type CharactersAnswer } from '../characters/characters';
import { refusalStatus, useBattlenetCharacters } from '../characters/useCharacters';
import { defaultGuildPath } from '../config';
import { useInviteTarget, useJoinTeam, type InviteTarget } from './useJoin';
import '../characters/characters.css';
import '../signup/signup.css';

// /join/<code> (#1264): the page an invite link opens. Team and guild name,
// Battle.net sign-in, character pick, then straight onto the roster -- the
// link is the approval. Sits outside the app shell: a visitor has no guild
// yet, so there is no sidebar to show. Same character pick as Sign Up (#1162).
export function JoinPage({ code }: { code: string }) {
  const target = useInviteTarget(code);
  return (
    <main className="content join-page">
      <DataState query={target} label="this invite link">
        {(t) => (t ? <Join code={code} target={t} /> : <DeadLink />)}
      </DataState>
    </main>
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
    <>
      <h1>
        Join {target.teamName} ({target.guildName})
      </h1>
      <p className="text-muted">Opening this link is the approval: you go straight onto the roster.</p>
    </>
  );

  if (!user) {
    return (
      <section className="card signup-card">
        {heading}
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
        <p className="text-muted">Connect your Discord too: your team roles and raid notifications come from it.</p>
        <button type="button" className="button" onClick={() => void connect(DISCORD, 'signup-character')}>
          Connect Discord
        </button>
      </section>
    );
  }
  return (
    <section className="card signup-card">
      {heading}
      <Picker code={code} target={target} />
    </section>
  );
}

function Picker({ code, target }: { code: string; target: InviteTarget }) {
  const { battlenetToken, refreshBattlenet } = useSession();
  const list = useBattlenetCharacters();
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
    read(
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
      {list.isError && (
        <>
          <p className="form-error" role="alert">
            Battle.net could not confirm that character: {list.error.message}
          </p>
          {refusalStatus(list.error) === 401 && (
            <button type="button" className="button" onClick={() => void refreshBattlenet('signup-character')}>
              Sign in with Battle.net again
            </button>
          )}
        </>
      )}
      <button
        type="button"
        className="button button-primary"
        disabled={!picked || join.isPending || list.isPending}
        onClick={onJoin}
      >
        {join.isPending || list.isPending ? 'Joining…' : `Join ${target.teamName}`}
      </button>
    </>
  );
}
