import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useAccess } from '../auth/access';
import { BATTLENET, DISCORD, useSession } from '../auth/session';
import { SUPPORT_DISCORD_URL } from '../config';
import {
  useCreateGuild,
  useGuildCreationOpen,
  useSetGuildCreationOpen,
  type CreatedGuild,
  type NewGuild
} from './useGuildCreation';
import './front.css';

const REGIONS = [
  ['us', 'Americas (US)'],
  ['eu', 'Europe (EU)'],
  ['kr', 'Korea (KR)'],
  ['tw', 'Taiwan (TW)']
] as const;

// Create your guild and its first team (#1226). Open to a site admin always,
// and to everyone signed in once a site admin flips the switch below.
export function CreateGuildPage() {
  const open = useGuildCreationOpen();
  return (
    <main className="content front-page">
      <h1>Create your guild</h1>
      <DataState query={open} label="guild creation">
        {(isOpen) => <Gate isOpen={isOpen} />}
      </DataState>
    </main>
  );
}

function Gate({ isOpen }: { isOpen: boolean }) {
  const { user, signIn, connect } = useSession();
  if (!user) {
    return (
      <section className="card front-next">
        {isOpen ? (
          <>
            <p>Sign in with Battle.net to create your guild and its first team.</p>
            <button type="button" className="button button-primary" onClick={() => void signIn(BATTLENET)}>
              Sign in with Battle.net
            </button>
          </>
        ) : (
          <Closed />
        )}
      </section>
    );
  }
  return <SignedInGate isOpen={isOpen} hasDiscord={user.hasDiscord} connectDiscord={() => connect(DISCORD)} />;
}

function SignedInGate({
  isOpen,
  hasDiscord,
  connectDiscord
}: {
  isOpen: boolean;
  hasDiscord: boolean;
  connectDiscord: () => Promise<void>;
}) {
  const access = useAccess();
  return (
    <DataState query={access} label="your account">
      {(a) => (
        <>
          {a.siteAdmin && <SwitchCard isOpen={isOpen} />}
          {!isOpen ? (
            // A site admin sees only the switch: turning it on shows the form.
            a.siteAdmin ? null : (
              <section className="card front-next">
                <Closed />
              </section>
            )
          ) : !hasDiscord ? (
            <section className="card front-next">
              <p>Connect your Discord too: you become your team’s leader, and team roles come from Discord.</p>
              <button type="button" className="button" onClick={() => void connectDiscord()}>
                Connect Discord
              </button>
            </section>
          ) : (
            <CreateForm />
          )}
        </>
      )}
    </DataState>
  );
}

function Closed() {
  return (
    <>
      <p>
        New guilds are set up by hand for now. Ask on the{' '}
        <a href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
          support Discord<span className="visually-hidden"> (opens in a new tab)</span>
        </a>{' '}
        and we’ll get yours started.
      </p>
    </>
  );
}

// Only a site admin sees this. The switch governs everyone, site admins
// included, so a guild is never created by accident. Second guilds are not
// fully supported yet (#1324), so it says so before anyone opens creation.
function SwitchCard({ isOpen }: { isOpen: boolean }) {
  const { announce } = useStatus();
  const set = useSetGuildCreationOpen();
  return (
    <section className="card front-next" aria-labelledby="switch-title">
      <h2 id="switch-title" className="section-title">
        Guild creation is {isOpen ? 'open' : 'closed'}
      </h2>
      <p className="text-muted">
        To create a guild, open this, create it, then close it again. Granting roles and adding teams stop working once
        there is a second guild (#1324), for We Go Again too, so leave it closed until that is fixed.
      </p>
      {set.isError && (
        <p className="form-error" role="alert">
          That did not save: {set.error.message}
        </p>
      )}
      <button
        type="button"
        className="button"
        disabled={set.isPending}
        onClick={() =>
          set.mutate(
            { open: !isOpen },
            {
              onSuccess: () => announce('success', isOpen ? 'Guild creation is closed.' : 'Guild creation is open.')
            }
          )
        }
      >
        {isOpen ? 'Close guild creation' : 'Open guild creation'}
      </button>
    </section>
  );
}

const EMPTY: NewGuild = { name: '', region: 'us', realm: '', teamName: '' };

function CreateForm() {
  const id = useId();
  const create = useCreateGuild();
  const [fields, setFields] = useState<NewGuild>(EMPTY);
  const [done, setDone] = useState<CreatedGuild | null>(null);
  const set = (key: keyof NewGuild, value: string) => setFields((f) => ({ ...f, [key]: value }));
  const ready = fields.name.trim() && fields.realm.trim();

  if (done) {
    return (
      <section className="card front-next">
        <h2 className="section-title">Your guild is ready</h2>
        <p>
          You’re the leader of {fields.teamName.trim() || fields.name.trim()}. Next, make an invite link so your raiders
          can join.
        </p>
        <Link className="button button-primary" to={`/g/${done.guildKey}/t/${done.teamKey}/officer/invite`}>
          Make an invite link
        </Link>
      </section>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    create.mutate(
      { ...fields, name: fields.name.trim(), realm: fields.realm.trim(), teamName: fields.teamName.trim() },
      { onSuccess: setDone }
    );
  };

  return (
    <form className="card front-next front-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          Guild name
        </label>
        <input id={`${id}-name`} className="input" value={fields.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-region`}>
          Region
        </label>
        <select
          id={`${id}-region`}
          className="input"
          value={fields.region}
          onChange={(e) => set('region', e.target.value)}
        >
          {REGIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-realm`}>
          Home realm
        </label>
        <input
          id={`${id}-realm`}
          className="input"
          value={fields.realm}
          onChange={(e) => set('realm', e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-team`}>
          First team’s name (optional)
        </label>
        <input
          id={`${id}-team`}
          className="input"
          value={fields.teamName}
          onChange={(e) => set('teamName', e.target.value)}
        />
      </div>
      <p className="text-muted front-hint">
        Only one team? Leave the team name blank and the team is named after your guild.
      </p>
      {create.isError && (
        <p className="form-error" role="alert">
          Could not create the guild: {create.error.message}
        </p>
      )}
      <button type="submit" className="button button-primary" disabled={!ready || create.isPending}>
        {create.isPending ? 'Creating…' : 'Create guild'}
      </button>
    </form>
  );
}
