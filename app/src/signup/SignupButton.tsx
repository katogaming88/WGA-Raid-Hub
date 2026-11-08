import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { useAddress, useTeam } from '../data/address';
import { useSignupSeasons } from '../roster/useRoster';
import { useOwnSignup } from './useSignup';
import './signup.css';

// A way into Sign up from the team's own pages (Kat, 2026-10-24): team Home,
// the Roster and My profile, beside Guild home's. Shown only while the team
// has signups open, and not while that read is loading or failed, as Guild
// home's: a link into a closed form is worse than none. Someone already signed
// up is told so rather than asked again.
export function useSignupLink() {
  const { guild } = useAddress();
  const team = useTeam();
  const { user } = useSession();
  const seasons = useSignupSeasons(team.id);
  const open = seasons.isSuccess ? seasons.data[0] : undefined;
  const own = useOwnSignup(team.id, open?.code ?? null, !!user && !!open);
  if (!open) return null;
  return {
    to: `/g/${guild.key}/t/${team.key}/signup`,
    season: open.name,
    signedUp: !!own.data
  };
}

export function SignupButton() {
  const link = useSignupLink();
  if (!link) return null;
  return (
    <Link className="button button-primary signup-button" to={link.to}>
      {link.signedUp ? `Your signup for ${link.season}` : `Sign up for ${link.season}`}
    </Link>
  );
}

// The same link as a strip across the top of every team page (#1630), so a
// raider need not know which page holds the button. Same rule as the button:
// nothing while closed, loading or failed. Not on the form it links to.
export function SignupBanner() {
  const link = useSignupLink();
  if (!link) return null;
  return (
    <div className="signup-banner">
      {link.signedUp ? (
        <Link to={link.to}>Your signup for {link.season}</Link>
      ) : (
        <>
          Signups are open for {link.season}. <Link to={link.to}>Sign up</Link>
        </>
      )}
    </div>
  );
}
