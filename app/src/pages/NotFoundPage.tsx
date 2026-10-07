import { Link, useParams } from 'react-router';

export type WayOn = { to: string; label: string };

// The most useful page to send someone to from a wrong address or a crash
// (#1477): their team's home when the address names a team, the guild page
// when it names only a guild, otherwise the site home.
export function wayOn(guildKey?: string, teamKey?: string): WayOn {
  if (guildKey && teamKey) return { to: `/g/${guildKey}/t/${teamKey}`, label: "Go to the team's home" };
  if (guildKey) return { to: `/g/${guildKey}`, label: 'Go to the guild page' };
  return { to: '/', label: 'Go to the home page' };
}

// A wrong address. Not reported to Sentry: a typo is not a fault in the app.
// `home` overrides the way on, for an address whose guild or team key does not
// exist, where linking back to it would land here again.
export function NotFoundPage({ home }: { home?: WayOn }) {
  const { guildKey, teamKey } = useParams();
  const way = home ?? wayOn(guildKey, teamKey);
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Page not found</h1>
      <div className="card problem-card">
        <p>There is nothing at this address. The link may have a typo, or the page may have moved.</p>
        <div className="problem-actions">
          <Link className="button button-primary" to={way.to}>
            {way.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
