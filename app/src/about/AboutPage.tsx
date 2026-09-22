import { SUPPORT_DISCORD_URL } from '../config';
import './about.css';

// About (#1102): what the Hub is and who built it, ported from the current
// site's About sub-tab. Static text; nothing here comes from the database.
export function AboutPage() {
  return (
    <section className="page about-page" aria-labelledby="page-title">
      <h1 id="page-title">About</h1>

      <article className="card about-card" aria-labelledby="about-what-title">
        <h2 id="about-what-title" className="section-title">
          What is this?
        </h2>
        <p>
          WGA Raid Hub is a raid management site built for We Go Again&rsquo;s raid teams. Every raider gets a personal
          profile &mdash; priority standing, BiS wishlist, attendance &mdash; and officers get a full dashboard for
          loot, signups, and roster management. Warcraftlogs and Raider.IO profiles are linked in for reference, and
          officers can pull in Warcraftlogs performance scores each season.
        </p>
      </article>

      <article className="card about-card" aria-labelledby="about-kat-title">
        <h2 id="about-kat-title" className="section-title">
          About Kat
        </h2>
        <p>
          Built and maintained by Kat (Katorri), a raid officer who got tired of juggling spreadsheets and built this
          instead. Bug reports and feature ideas are always welcome &mdash; reach out on the{' '}
          <a href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
            support Discord<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          .
        </p>
      </article>
    </section>
  );
}
