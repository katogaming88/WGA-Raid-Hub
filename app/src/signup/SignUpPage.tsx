import { useState } from 'react';
import { DataState } from '../components/DataState';
import { charactersOn, useAccess } from '../auth/access';
import { useSession } from '../auth/session';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { seasonName } from '../profile/profile';
import { useRosterPlayers, useSignupSeasons } from '../roster/useRoster';
import { SignUpWizard, type WizardEdit } from './SignUpWizard';
import { SignupSummary } from './SignupSummary';
import { classmatesPool, type ClassmateRow } from './signup';
import { useIncomingWithSwap, useLiveSeasonCode, useOwnSignup, useRoleTargets } from './useSignup';
import './signup.css';

// Sign Up (#1102): the multi-step form, ported from js/signup.js. Reachable
// from a team's card on Guild home when it has signups open, and directly by
// address.
export function SignUpPage() {
  const team = useTeam();
  const { user } = useSession();
  const seasons = useSignupSeasons(team.id);

  return (
    <section className="page signup-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Sign up</h1>
      </div>
      {!user ? (
        <div className="card signup-card">
          <p>You must sign in to do this.</p>
        </div>
      ) : (
        <div className="card signup-card">
          <DataState query={seasons} label="the open seasons">
            {(codes) =>
              codes.length ? (
                <SignUpForTier teamId={team.id} codes={codes} />
              ) : (
                <p className="text-muted">Signups are not open for this team right now.</p>
              )
            }
          </DataState>
        </div>
      )}
    </section>
  );
}

function SignUpForTier({ teamId, codes }: { teamId: number; codes: string[] }) {
  const [tierOverride, setTierOverride] = useState<string | null>(null);
  const tier = tierOverride && codes.includes(tierOverride) ? tierOverride : codes[0]!;
  const [editing, setEditing] = useState(false);

  const access = useAccess();
  const ownSignup = useOwnSignup(teamId, tier);
  const roster = useRosterPlayers(teamId);
  const incoming = useIncomingWithSwap(teamId);
  const liveSeason = useLiveSeasonCode(teamId);
  const targets = useRoleTargets(teamId);

  const page = bothQueries(
    bothQueries(bothQueries(access, ownSignup), bothQueries(roster, incoming)),
    bothQueries(liveSeason, targets)
  );

  return (
    <>
      {codes.length > 1 && (
        <div className="field signup-tier-picker">
          <label className="field-label" htmlFor="signup-tier">
            Signing up for
          </label>
          <select
            id="signup-tier"
            className="select"
            value={tier}
            onChange={(e) => {
              setTierOverride(e.target.value);
              setEditing(false);
            }}
          >
            {codes.map((code) => (
              <option key={code} value={code}>
                {seasonName(code)}
              </option>
            ))}
          </select>
        </div>
      )}
      <DataState query={page} label="your signup">
        {([[[accessData, own], [rosterRows, incomingRows]], [liveSeasonCode, targetsData]]) => {
          const claimed = charactersOn(accessData, teamId)[0] ?? null;
          const claimNameRealm = claimed?.nameRealm ?? null;
          const claimedPlayer = claimNameRealm
            ? rosterRows.find((p) => p.name_realm.toLowerCase() === claimNameRealm.toLowerCase())
            : null;
          const claimedClass = claimedPlayer?.classes_specs?.class ?? null;
          const rosterAsClassmates: ClassmateRow[] = rosterRows.map((p) => ({
            nameRealm: p.name_realm,
            class: p.classes_specs?.class ?? null,
            spec: p.classes_specs?.spec ?? null,
            role: p.classes_specs?.role ?? null
          }));
          const classmates = classmatesPool(incomingRows, rosterAsClassmates, liveSeasonCode, tier);

          if (own && !editing) {
            return <SignupSummary row={own} tier={tier} onEdit={() => setEditing(true)} />;
          }

          const edit: WizardEdit | null = own
            ? {
                signupId: own.id,
                fields: {
                  charName: own.signup_name_realm.split('-')[0] ?? '',
                  realm: own.signup_name_realm.split('-').slice(1).join('-'),
                  className: (own.main_swap ? own.swap_class : own.class) ?? '',
                  mainSpec: (own.main_swap ? own.swap_spec : own.spec) ?? '',
                  offSpecs: (own.off_specs ?? '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  primaryRole: null,
                  notes: own.player_note ?? ''
                }
              }
            : null;

          return (
            <SignUpWizard
              teamId={teamId}
              season={tier}
              edit={edit}
              claimNameRealm={claimNameRealm}
              claimedClass={claimedClass}
              classmates={classmates}
              roleTargets={targetsData}
              onDone={() => setEditing(false)}
            />
          );
        }}
      </DataState>
    </>
  );
}
