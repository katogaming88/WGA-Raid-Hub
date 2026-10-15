import { BATTLENET, useSession } from '../auth/session';
import { BrandLogo } from '../components/Icon';
import { useStatus } from '../components/Status';
import { useClaimName } from './useNames';
import type { AccountLinks } from './useRoster';

// Officers: the Battle.net and Discord logos under a member's name (#1360
// part 4), lit when connected and grey with "Not linked" when not, so the
// state never rests on color alone. The account names arrive with #1484.
export function AccountsLine({ links }: { links: AccountLinks }) {
  return (
    <span className="accounts-line">
      <Account brand="battlenet" label="Battle.net" linked={links.battlenet} />
      <Account brand="discord" label="Discord" linked={links.discord} />
    </span>
  );
}

function Account({ brand, label, linked }: { brand: 'battlenet' | 'discord'; label: string; linked: boolean }) {
  return (
    <span className={`account account-${brand}${linked ? ' linked' : ''}`}>
      <BrandLogo brand={brand} />
      {linked ? (
        <span className="visually-hidden">{label} connected</span>
      ) : (
        <>
          <span className="visually-hidden">{label}:</span> Not linked
        </>
      )}
    </span>
  );
}

// A blue Claim under an unclaimed Member (#1360 part 4). The
// "..." menu keeps its Claim too. Signed out, it starts Battle.net sign-in;
// back on the Roster, the same link claims.
export function QuickClaim({ teamId, nameId, label }: { teamId: number; nameId: number; label: string }) {
  const { user, signIn } = useSession();
  const { announce } = useStatus();
  const claim = useClaimName(teamId);
  const onClick = () => {
    if (!user) {
      void signIn(BATTLENET);
      return;
    }
    claim.mutate({ nameId }, { onSuccess: () => announce('success', `Claimed ${label}.`) });
  };
  return (
    <span className="accounts-line">
      <button
        type="button"
        className="quick-claim"
        onClick={onClick}
        disabled={claim.isPending}
        aria-label={`${claim.isPending ? 'Claiming' : 'Claim'} ${label}`}
      >
        <BrandLogo brand="battlenet" />
        {claim.isPending ? 'Claiming…' : 'Claim'}
      </button>
      {claim.isError && (
        <span className="form-error" role="alert">
          That did not save: {claim.error.message}
        </span>
      )}
    </span>
  );
}
