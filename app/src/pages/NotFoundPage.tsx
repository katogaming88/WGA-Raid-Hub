import { Link } from 'react-router';
import { defaultPath } from '../config';

export function NotFoundPage() {
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Page not found</h1>
      <div className="card placeholder">
        <p>Nothing lives at this address. It may have moved, or the link may have a typo.</p>
        <Link to={defaultPath()}>Go to the home page</Link>
      </div>
    </section>
  );
}
