import { Link } from 'react-router';
import { useAccess } from '../auth/access';
import { LogoMark } from '../components/Icon';
import { ADDON_URL, SUPPORT_DISCORD_URL } from '../config';
import { useSeasons } from '../calendar/useCalendar';
import { currentSeason } from '../profile/profile';
import { useNews } from '../news/useNews';
import { newestEntry } from '../news/news';
import { isoDateShort } from '../lib/dates';
import { useGuildCreationOpen } from './useGuildCreation';
import './front.css';

// The site front page (#1226), in the app's frame like News and Help. The same
// page for everyone, signed in or out, on a team or not (Kat, 2026-10-15);
// only the sidebar differs. Layout from the 2026-10-15 mockups.
export function FrontPage() {
  // Until these load, or if they fail, the page shows the closed wording. A
  // site admin gets the form while creation is closed too, since the switch
  // that opens it lives there.
  const open = useGuildCreationOpen().data === true;
  const siteAdmin = useAccess().data?.siteAdmin === true;
  return (
    <div className="front-home">
      <section className="front-hero" aria-labelledby="front-title">
        <Banner />
        <div className="front-hero-inner">
          <div className="front-pitch">
            {/* The site's name over the headline (Kat, 2026-10-17). */}
            <p className="front-name">
              <LogoMark size={44} />
              WGA Raid Hub
            </p>
            <h1 id="front-title">Your raid team’s loot, roster and raid nights, in one place.</h1>
            <p className="front-lede">
              Raiders see where they stand for loot and whether they’re in tonight. Officers run the season without a
              stack of spreadsheets.
            </p>
            {open || siteAdmin ? (
              <div className="front-actions">
                <Link className="button button-primary" to="/new-guild">
                  Create your guild
                </Link>
                <a className="button" href="#front-week">
                  See what it does
                </a>
              </div>
            ) : (
              <>
                <div className="front-closed">
                  <p className="front-closed-title">New guilds can’t sign up yet</p>
                  <p className="text-muted">
                    We’re opening it up soon. If you’d like your guild on the Raid Hub, say hello in the support Discord
                    and we’ll let you know.
                  </p>
                  <div className="front-actions">
                    <DiscordLink className="button button-primary" label="Ask in the support Discord" />
                    <a className="button" href="#front-week">
                      See what it does
                    </a>
                  </div>
                </div>
                <p className="front-note text-muted">
                  Already on a team? Open your invite link or sign in. That works now.
                </p>
              </>
            )}
            <WorksWith />
          </div>
          <div className="front-side">
            <SeasonBox />
            <NewsBox />
          </div>
        </div>
      </section>

      <section className="front-invite" aria-labelledby="front-invite-title">
        <h2 id="front-invite-title">Got an invite link?</h2>
        <ol>
          {INVITE_STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="front-step" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <strong>{title}</strong>
                <span className="text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section id="front-week" className="front-week" aria-labelledby="front-week-title">
        <h2 id="front-week-title">Built around your raid week</h2>
        <p className="text-muted">
          Every part of the Hub fits somewhere in the week, from deciding who’s coming to checking it was fair.
        </p>
        <div className="front-cards">
          {WEEK.map((card) => (
            <article key={card.id} className="front-card">
              {/* A strip of the real page, from `npm run help:shots`. */}
              <img className="front-shot" src={`${import.meta.env.BASE_URL}front-shots/${card.id}.png`} alt="" />
              <div className="front-card-body">
                <p className="front-kicker">{card.when}</p>
                <h3>{card.title}</h3>
                <ul>
                  {card.points.map(([name, text]) => (
                    <li key={name}>
                      <strong>{name}.</strong> <span className="text-muted">{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="front-who" aria-labelledby="front-who-title">
        <div>
          <p className="front-kicker">Who makes it</p>
          <h2 id="front-who-title">Made by a raiding guild, for raiding guilds</h2>
        </div>
        <div className="front-who-text">
          <p>WGA (We Go Again) Raid Hub is built by Katorri, an Officer in We Go Again-Tichondrius (NA).</p>
          <p>
            It started as one spreadsheet that pulled together three others: our roster, our attendance and our loot
            history. We built it to run our own Loot Priority system, an order for every drop based on who shows up, how
            they play and what they still need.
          </p>
          <p>
            The spreadsheet became this site, so every raider can see where they stand and officers stop juggling
            sheets. We use it every raid night, and now other guilds can too.
          </p>
          <Link to="/about">More about us</Link>
        </div>
      </section>

      <section className="front-running" aria-labelledby="front-running-title">
        <div>
          <h2 id="front-running-title">Running a guild?</h2>
          <p className="text-muted">
            Create your guild, set up your first team, then send your raiders one link. Every step has a guide in{' '}
            <Link to="/help">Help</Link>.
          </p>
        </div>
        <DiscordLink className="button" label="Ask in the support Discord" />
      </section>

      <footer className="front-footer">
        <span>WGA Raid Hub</span>
        <nav aria-label="Site links">
          <Link to="/news">News</Link>
          <Link to="/about">About</Link>
          <Link to="/help">Help</Link>
          <DiscordLink label="Support Discord" />
          {/* Terms, Privacy and Cookies join this list once their pages exist (#1527). */}
        </nav>
      </footer>
    </div>
  );
}

function DiscordLink({ className, label }: { className?: string; label: string }) {
  return (
    <a className={className} href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
      {label}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

// The Go Again ring logo (picked 2026-09-18), large and faded behind the
// headline. Same shapes as the logo's SVG master; colors from the theme.
function Banner() {
  return (
    <svg className="front-banner" aria-hidden="true" focusable="false" viewBox="0 0 100 100">
      {/* Fades out at the bottom, so the hero's edge doesn't cut the ring off.
          Inside the SVG: a CSS mask on it left a faint edge in Chrome. */}
      <defs>
        <linearGradient id="front-banner-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#fff" />
          <stop offset="0.92" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="front-banner-mask">
          <rect width="100" height="100" fill="url(#front-banner-fade)" />
        </mask>
      </defs>
      <g mask="url(#front-banner-mask)">
        <path className="front-ring" d="M50 6 A44 44 0 1 1 11.9 28" strokeWidth="7" strokeLinecap="round" />
        <polygon className="front-arrow" points="15.9,19.9 18.0,33.1 4.8,26.1" />
        <circle className="front-disc" cx="50" cy="50" r="33" />
        <polyline
          className="front-w"
          points="32,39 41,63 50,46 59,63 68,39"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function WorksWith() {
  return (
    <div className="front-works">
      <span className="front-kicker">Works with</span>
      <ul>
        <li>Battle.net</li>
        <li>Discord</li>
        <li>Warcraft Logs</li>
        <li>
          <a href={ADDON_URL} target="_blank" rel="noopener noreferrer">
            RCLootCouncil <span className="front-works-extra">· get our addon</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </li>
      </ul>
    </div>
  );
}

// Nothing shows until the read answers; a failed read drops the box rather than
// putting an error on the front page.
function SeasonBox() {
  const seasons = useSeasons();
  const season = seasons.data ? currentSeason(seasons.data) : null;
  if (!season) return null;
  return (
    <div className="front-box">
      <span className="front-kicker">Current season</span>
      <strong>{season.display_name}</strong>
    </div>
  );
}

function NewsBox() {
  const news = useNews();
  const entry = news.data ? newestEntry(news.data) : null;
  if (!entry) return null;
  return (
    <Link className="front-box" to="/news">
      <span className="front-kicker">Latest news · {isoDateShort(entry.date)}</span>
      <strong>{entry.title}</strong>
      <span className="front-box-more">Read it</span>
    </Link>
  );
}

const INVITE_STEPS = [
  ['Open your team’s invite link', 'The one your officers sent you.'],
  ['Sign in with Battle.net', 'Your characters come with you. Then connect Discord.'],
  ['Mark your wishlist', 'Pick your BiS before the next raid.']
] as const;

const WEEK = [
  {
    id: 'before-raid',
    when: 'Before raid',
    title: 'Get the team ready',
    points: [
      ['Calendar and signups', 'Raiders say if they’re coming; officers see who’s short.'],
      ['Wishlists', 'Everyone marks their BiS, so you know who needs what.'],
      ['Roster', 'One per raid team, with every raider’s characters from Battle.net.']
    ]
  },
  {
    id: 'raid-night',
    when: 'Raid night',
    title: 'Hand out loot without arguing',
    points: [
      ['Loot priority', 'An order for every drop from your team’s own attendance, gear and performance.'],
      ['In the loot window', 'The order shows in RCLootCouncil while you award it.'],
      ['Boss by boss', 'Plan who’s in for each fight and swap people with a click.']
    ]
  },
  {
    id: 'after-raid',
    when: 'After raid',
    title: 'Check it was fair',
    points: [
      ['Loot history', 'Import the night’s loot and it comes off everyone’s lists.'],
      ['Attendance', 'Read from your Warcraft Logs, counted the way your team decides.'],
      ['Reports', 'Who’s gone longest without an item, who sits out most, and more.']
    ]
  },
  {
    id: 'across-the-guild',
    when: 'Across the guild',
    title: 'Every team, one guild',
    points: [
      ['Several raid teams', 'Each runs its own roster and loot rules.'],
      ['BoE sales', 'Log a find, list it, and track the sale and who gets paid.'],
      ['Who’s who', 'Guild and team officers, with who can do what.']
    ]
  }
] as const;
