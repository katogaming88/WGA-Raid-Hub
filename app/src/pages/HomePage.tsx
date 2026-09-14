import { useParams } from 'react-router';

export function HomePage() {
  const { teamKey } = useParams();
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Home</h1>
      <div className="card placeholder">
        <p>
          This is the new WGA Raid Hub, still being built. The <strong className="team-key">{teamKey}</strong> home page
          comes later; for now this checks the frame, the colors and both themes.
        </p>
        <button type="button" className="button button-primary">
          Main button
        </button>{' '}
        <button type="button" className="button">
          Other button
        </button>
      </div>
    </section>
  );
}
