import { useState } from 'react';
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router';
import { Dialog } from '../components/Dialog';
import { SUPPORT_DISCORD_URL } from '../config';
import { GUIDES, QUESTIONS, SETUP, TOPICS, WEEK, type Bases, type Guide } from './guide';
import './help.css';

// The Help page (#1526): one page for everyone, officer jobs tagged. Setting
// up a guild, the raid week, how Loot priority works, guides by topic, common
// questions, and the support Discord. A guide opens in a side panel at
// /help/<guide>, so it can be linked. Every link on the page opens a guide;
// only a guide's own "Take me there" goes off to the page (Kat, 2026-10-15).
// Guide pictures are taken at twice the pixels and given only as a 2x
// srcset, so every screen shows them at their real size (a plain src would
// count as 1x and show them double on a normal screen).
export function HelpPage() {
  const base = useOutletContext<Bases>();
  const { guideId } = useParams();
  const navigate = useNavigate();
  const open = guideId ? GUIDES.find((g) => g.id === guideId) : undefined;
  // Full view shows the guide as the page itself, so the sidebar stays usable
  // (a panel locks everything behind it). Leaving the guide resets it.
  const [full, setFull] = useState(false);
  if (!open && full) setFull(false);
  if (guideId && !open) return <Navigate to="/help" replace />;
  const guideHref = (id: string) => `/help/${id}`;

  if (open && full) {
    return (
      <section className="page help-guide-page" aria-labelledby="page-title">
        <Link to="/help" className="help-back">
          All help
        </Link>
        <h1 id="page-title">{open.title}</h1>
        <GuideBody guide={open} base={base} full onToggle={() => setFull(false)} />
      </section>
    );
  }

  return (
    <section className="page help-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Help</h1>
        <p className="text-muted page-subtitle">
          How things work here, what to click, and where to ask. Officer jobs are marked <OfficersTag />.
        </p>
      </div>

      <section className="help-section" aria-labelledby="help-setup">
        <h2 id="help-setup" className="section-title">
          Bringing your guild here
        </h2>
        <p className="text-muted">
          For whoever runs the guild: from nothing to your first raid night. Joining a guild that’s already here? Just
          do step 1.
        </p>
        <ol className="help-setup">
          {SETUP.map((s, i) => {
            const body = (
              <>
                <span className="help-eyebrow">{i === 0 ? 'Step 1 · Everyone' : `Step ${i + 1}`}</span>
                <span className="help-setup-title">{s.title}</span>
                <span className="text-muted">{s.text}</span>
              </>
            );
            return (
              <li key={s.title}>
                {s.guide ? (
                  <Link className="card help-setup-step" to={guideHref(s.guide)}>
                    {body}
                  </Link>
                ) : (
                  <div className="card help-setup-step">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="help-section" aria-labelledby="help-week">
        <h2 id="help-week" className="section-title">
          Your raid week
        </h2>
        <p className="text-muted">What to do here, in the order it comes up.</p>
        <div className="card help-week">
          {WEEK.map((part, i) => (
            <div key={part.title} className="help-week-part">
              <h3 className="help-week-title">
                <span className="help-week-number" aria-hidden="true">
                  {i + 1}
                </span>
                {part.title}
              </h3>
              <ul>
                {part.jobs.map((job) => (
                  <li key={job.label}>
                    {job.guide ? <Link to={guideHref(job.guide)}>{job.label}</Link> : <span>{job.label}</span>}
                    {job.officers && <OfficersTag />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="help-section" id="loot-priority" aria-labelledby="help-loot">
        <h2 id="help-loot" className="section-title">
          How Loot priority works
        </h2>
        <p className="text-muted">For teams that use the Loot priority system.</p>
        <ol className="help-flow">
          <li className="card">
            <span className="help-eyebrow">1 · Raider</span>
            <span className="help-setup-title">Marks BiS on their wishlist</span>
            <span className="text-muted">One item per slot. Pass on what they would not take.</span>
          </li>
          <li className="card">
            <span className="help-eyebrow">2 · The Hub</span>
            <span className="help-setup-title">Works out the priority order</span>
            <span className="text-muted">From attendance, performance and the tier pieces still needed.</span>
          </li>
          <li className="card">
            <span className="help-eyebrow">3 · Officers, raid night</span>
            <span className="help-setup-title">Award the drop</span>
            <span className="text-muted">The priority order shows in the in-game loot window.</span>
          </li>
          <li className="card">
            <span className="help-eyebrow">4 · Officers, after raid</span>
            <span className="help-setup-title">Import, and it’s received</span>
            <span className="text-muted">The night’s loot is imported and that slot comes off the raider’s list.</span>
          </li>
        </ol>
      </section>

      <section className="help-section" aria-labelledby="help-guides">
        <h2 id="help-guides" className="section-title">
          Guides
        </h2>
        <div className="help-topics">
          {TOPICS.map((topic) => (
            <article key={topic.id} className="card help-topic">
              <h3 className="help-topic-title">{topic.title}</h3>
              <p className="text-muted">{topic.blurb}</p>
              <ul>
                {GUIDES.filter((g) => g.topic === topic.id).map((g) => (
                  <li key={g.id}>
                    <Link to={guideHref(g.id)}>{g.title}</Link>
                    {g.officers && <OfficersTag />}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="help-section" aria-labelledby="help-questions">
        <h2 id="help-questions" className="section-title">
          Common questions
        </h2>
        <div className="card help-questions">
          {QUESTIONS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="card help-support">
        <h2 className="section-title">Still stuck, or something looks wrong?</h2>
        <p>
          Ask in the support Discord. It reaches the people who run the Hub, and others may have hit the same thing.
        </p>
        <a className="button" href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Join the support Discord<span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </div>

      {open && (
        <Dialog title={open.title} onClose={() => void navigate('/help')} side>
          <GuideBody guide={open} base={base} full={false} onToggle={() => setFull(true)} />
        </Dialog>
      )}
    </section>
  );
}

function OfficersTag() {
  return <span className="help-tag">Officers</span>;
}

function GuideBody({
  guide,
  base,
  full,
  onToggle
}: {
  guide: Guide;
  base: Bases;
  full: boolean;
  onToggle: () => void;
}) {
  const topic = TOPICS.find((t) => t.id === guide.topic)!;
  const inTopic = GUIDES.filter((g) => g.topic === guide.topic);
  const next = inTopic[inTopic.indexOf(guide) + 1];
  return (
    <div className="help-guide">
      <div className="help-panel-bar">
        <p className="help-eyebrow">
          {topic.title}
          {guide.officers && ' · for officers'}
        </p>
        <button type="button" className="button help-full" aria-pressed={full} onClick={onToggle}>
          {full ? 'Side view' : 'Full view'}
        </button>
      </div>
      <div className="help-quick">
        <span className="help-eyebrow">Quick answer</span>
        <p>{guide.quick}</p>
      </div>
      {guide.place && (
        <Link className="button button-primary help-go" to={guide.place.to(base)}>
          Take me there: {guide.place.label}
        </Link>
      )}
      {guide.menu && (
        <img
          className="help-picture help-menu-picture"
          srcSet={`/help-shots/${guide.id}-menu.png 2x`}
          alt={`Step 1: ${guide.menu}.`}
        />
      )}
      {guide.picture &&
        (full ? (
          <img className="help-picture" srcSet={`/help-shots/${guide.id}.png 2x`} alt={guide.picture} />
        ) : (
          // In the side panel the picture opens full view, to see it bigger.
          <button type="button" className="help-picture-button" onClick={onToggle}>
            <span className="visually-hidden">Open full view: </span>
            <img className="help-picture" srcSet={`/help-shots/${guide.id}.png 2x`} alt={guide.picture} />
          </button>
        ))}
      <ol className="help-steps">
        {guide.steps.map((step, i) => (
          <li key={step}>
            <span className={guide.marked?.includes(i + 1) ? 'help-step-n is-marked' : 'help-step-n'}>{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="help-next">
        {next ? <Link to={`/help/${next.id}`}>Next guide: {next.title}</Link> : <Link to="/help">All help</Link>}
      </p>
    </div>
  );
}
