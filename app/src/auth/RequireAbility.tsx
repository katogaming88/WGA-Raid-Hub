import type { ReactNode } from 'react';
import { DataState } from '../components/DataState';
import { useAddress } from '../data/address';
import { useCan, type Ability } from './access';
import { useSession } from './session';

// Wraps a page only some people may open (the officer tools). The heading
// stays, so the page is still named; the body says why it is closed. The
// database refuses the reads and writes on its own, so this is about showing
// a clear message instead of an empty page.
// `forWhom` names who the page is for in the closed message; officers by default.
export function RequireAbility({
  ability,
  title,
  forWhom,
  children
}: {
  ability: Ability;
  title: string;
  forWhom?: string;
  children: ReactNode;
}) {
  const { user } = useSession();
  const { team, guild } = useAddress();
  const permissions = useCan(team?.id, guild.id);

  let body: ReactNode;
  if (!user) {
    body = <p>Sign in to see this page. It is for {forWhom ?? 'officers'}.</p>;
  } else if (permissions.loading || permissions.error) {
    body = (
      <DataState query={permissions.query} label="your access">
        {() => null}
      </DataState>
    );
  } else if (!permissions.can(ability)) {
    body = <p>This page is for {forWhom ?? `officers of ${team?.name ?? 'this team'}`}.</p>;
  } else {
    return <>{children}</>;
  }

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      <div className="card placeholder">{body}</div>
    </section>
  );
}
