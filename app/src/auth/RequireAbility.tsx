import type { ReactNode } from 'react';
import { DataState } from '../components/DataState';
import { useAddress } from '../data/address';
import { can, useAccess, type Ability } from './access';
import { useSession } from './session';

// Wraps a page only some people may open (the officer tools). The heading
// stays, so the page is still named; the body says why it is closed. The
// database refuses the reads and writes on its own, so this is about showing
// a clear message instead of an empty page.
export function RequireAbility({ ability, title, children }: { ability: Ability; title: string; children: ReactNode }) {
  const { user } = useSession();
  const { team } = useAddress();
  const access = useAccess();

  let body: ReactNode;
  if (!user) {
    body = <p>Sign in to see this page. It is for officers.</p>;
  } else if (access.isPending || access.isError) {
    body = (
      <DataState query={access} label="your access">
        {() => null}
      </DataState>
    );
  } else if (!can(access.data, ability, team?.id)) {
    body = <p>This page is for officers of {team?.name ?? 'this team'}.</p>;
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
