import { useEffect } from 'react';
import { Link, useParams, useRouteError } from 'react-router';
import { reportError } from '../lib/errors';
import { wayOn } from './NotFoundPage';

// What a crash shows instead of React Router's built-in screen (#1477). One
// for every route: inside the frame for a page, so the sidebar still works,
// and on its own for anything outside it. The details go to Sentry, never to
// the screen.
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
      </div>
    </section>
  );
}
