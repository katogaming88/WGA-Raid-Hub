import { SUPPORT_DISCORD_URL } from '../config';
import { GUIDE } from './guide';
import './help.css';

// The Help page (#1102): where to ask a person, then a short guide to what a
// raider does in the app. The support Discord is the way to reach Kat or Rex,
// so nobody has to message them directly.
export function HelpPage() {
  return (
    <section className="page help-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Help</h1>
        <p className="text-muted page-subtitle">How to do the things raiders do here, and where to ask.</p>
      </div>

      <div className="card help-support">
        <h2 className="section-title">Stuck, or something looks wrong?</h2>
        <p>
          Ask in the support Discord. It reaches the people who run the Hub, and others may have hit the same thing.
        </p>
        <a className="button" href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Join the support Discord<span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </div>

      <div className="help-guide">
        <h2 className="section-title">Raider guide</h2>
        {GUIDE.map((card) => (
          <article key={card.title} className="card help-card">
            <h3 className="help-card-title">{card.title}</h3>
            <ol className="help-steps">
              {card.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
