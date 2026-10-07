import { useEffect } from 'react';
import { Link, useParams, useRouteError } from 'react-router';
import { errorMessage, reportError } from '../lib/errors';
import { SUPPORT_DISCORD_URL } from '../config';
import { wayOn } from './NotFoundPage';

// What a crash shows instead of React Router's built-in screen (#1477). One
// for every route: inside the frame for a page, so the sidebar still works,
// and on its own for anything outside it. The whole error goes to Sentry; the
// screen offers only its one-line message, folded away, for someone reporting
// it on the support Discord (Kat, 2026-10-07). Never the stack.
export function ErrorPage() {
  const error = useRouteError();
  const { guildKey, teamKey } = useParams();
  useEffect(() => {
    reportError(error, { where: 'page crash' });
  }, [error]);
  const way = wayOn(guildKey, teamKey);
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Something went wrong on this page</h1>
      <div className="card problem-card">
        <p>The page ran into a problem and stopped. It has been reported. Reloading the page often fixes it.</p>
        <div className="problem-actions">
          <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <Link className="button" to={way.to}>
            {way.label}
          </Link>
        </div>
        <details className="problem-details">
          <summary>Show error details</summary>
          <p>
            <code>{errorMessage(error)}</code>
          </p>
          <p>
            If this keeps happening, share these details on the{' '}
            <a href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
              support Discord<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            .
          </p>
        </details>
      </div>
    </section>
  );
}
