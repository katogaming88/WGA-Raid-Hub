import { Link, Navigate } from 'react-router';
import { DataState } from '../components/DataState';
import { useAccess } from '../auth/access';
import { BATTLENET, useSession } from '../auth/session';
import { defaultGuildPath, SUPPORT_DISCORD_URL } from '../config';
import { useGuildCreationOpen } from './useGuildCreation';
import './front.css';

// The site's front address (#1226), for anyone who is not on a team: signed
// out, or signed in but not joined anywhere. A person on a team skips it and
// lands on their guild's home. Nobody creates a guild from here yet -- for now
// only a site admin can (Kat, 2026-09-24), so the page says what the Hub is and
// where to ask instead of showing a create form.
export function FrontPage() {
  const { user } = useSession();
  if (!user) return <FrontContent signedIn={false} />;
  return <SignedInFront />;
}

// Reads who the person is before deciding, so a raider is never shown the front
// page for a moment before being sent on.
function SignedInFront() {
  const access = useAccess();
  return (
    <DataState query={access} label="your account">
      {(a) => (a.teams.length > 0 ? <Navigate to={defaultGuildPath()} replace /> : <FrontContent signedIn />)}
    </DataState>
  );
}

const FEATURES = [
  [
    'Loot priority',
    'A priority order built from your own team’s attendance, gear and performance, exported straight back into RCLootCouncil.'
  ],
  [
    'BiS lists and wishlists',
    'Raiders submit their best-in-slot list and per-item wishlist, so officers see who needs what.'
  ],
  ['Roster and attendance', 'One roster per raid team, with attendance counted for you each raid night.'],
  ['Signups', 'A season signup form that goes to officers, then onto the roster.'],
  [
    'Calendar and RSVPs',
    'Raid nights on a calendar, with raiders answering yes, no or maybe and lineups planned per boss.'
  ],
  ['BoE sales', 'Report a BoE drop, list it, and track the sale and payout.']
] as const;

function FrontContent({ signedIn }: { signedIn: boolean }) {
  const { signIn } = useSession();
  // Until it loads, or if it fails, the page shows the closed wording: nothing
  // here depends on it.
  const canCreate = useGuildCreationOpen().data === true;
  return (
    <main className="content front-page">
      <section className="front-hero" aria-labelledby="front-title">
        <h1 id="front-title">WGA Raid Hub</h1>
        <p>
          Run a World of Warcraft raid guild from one place: roster, loot priority, wishlists, attendance, signups and
          the raid calendar, for every raid team in the guild. Raiders check their own standing, and officers run the
          season without side spreadsheets.
        </p>
        <div className="front-actions">
          {!signedIn && (
            <button type="button" className="button button-primary" onClick={() => void signIn(BATTLENET)}>
              Sign in with Battle.net
            </button>
          )}
          {canCreate && (
            <Link className="button" to="/new-guild">
              Create your guild
            </Link>
          )}
          <a className="button" href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
            Ask on the support Discord<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>
      </section>

      <ul className="front-features" aria-label="What the Raid Hub does">
        {FEATURES.map(([title, text]) => (
          <li key={title} className="card front-feature">
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ul>

      <section className="card front-next" aria-labelledby="front-next-title">
        <h2 id="front-next-title" className="section-title">
          {signedIn ? 'You’re not on a team yet' : 'Already raiding with a team?'}
        </h2>
        <p>
          {signedIn
            ? 'Open the invite link your team leader or an officer sent you, and you’ll join the team and land on its roster.'
            : 'Open the invite link your team leader or an officer sent you, or sign in above if you’re already on a team.'}
        </p>
        <p>
          {canCreate
            ? 'Want your own guild on the Raid Hub? Create it, and its first team, in a minute.'
            : 'Want your own guild on the Raid Hub? New guilds are set up by hand for now, so ask on the support Discord.'}
        </p>
      </section>
    </main>
  );
}
