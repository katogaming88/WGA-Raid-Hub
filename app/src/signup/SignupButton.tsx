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
export function SignupButton() {
  const { guild } = useAddress();
  const team = useTeam();
  const { user } = useSession();
  const seasons = useSignupSeasons(team.id);
  const open = seasons.isSuccess ? seasons.data[0] : undefined;
  const own = useOwnSignup(team.id, open?.code ?? null, !!user && !!open);
  if (!open) return null;
  return (
    <Link className="button button-primary signup-button" to={`/g/${guild.key}/t/${team.key}/signup`}>
      {own.data ? `Your signup for ${open.name}` : `Sign up for ${open.name}`}
    </Link>
  );
}
