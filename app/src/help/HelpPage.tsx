import { Fragment, useState } from 'react';
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router';
import { Dialog } from '../components/Dialog';
import { SUPPORT_DISCORD_URL } from '../config';
import {
  GUIDES,
  LOOT_FLOW,
  MENUS,
  QUESTIONS,
  SETUP,
  SETUP_ALSO,
  TOPICS,
  WEEK,
  guideById,
  isOfficerJob,
  type Bases,
  type Guide,
  type WeekJob
} from './guide';
import './help.css';

// The Help page (#1526, redesigned by #1666): one page for everyone. The raid
// week comes first, with officer jobs behind a checkbox; then common questions
// and the support Discord, how Loot priority works, setting up a guild, and
// every guide by topic. A guide opens in a side panel at
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
  const [showOfficers, setShowOfficers] = useState(false);
  if (!open && full) setFull(false);
  if (guideId && !open) return <Navigate to="/help" replace />;

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
        <p className="text-muted page-subtitle">How things work here, what to click, and where to ask.</p>
      </div>

      <label className="help-officers">
        <input type="checkbox" checked={showOfficers} onChange={(e) => setShowOfficers(e.target.checked)} />
        Show officer jobs
      </label>

      <section className="help-week" aria-labelledby="help-week">
        <div className="help-week-head">
          <h2 id="help-week" className="help-heading">
            Your raid week
          </h2>
          <p className="text-muted">What to do here, in the order it comes up.</p>
        </div>
        <div className="help-week-parts">
          {WEEK.map((part, i) => {
            const officerJobs = part.jobs.filter(isOfficerJob);
            return (
              <div key={part.title} className="help-week-part">
                <h3>
                  <span aria-hidden="true">0{i + 1}</span>
                  {part.title}
                </h3>
                <JobList jobs={part.jobs.filter((job) => !isOfficerJob(job))} />
                {showOfficers && officerJobs.length > 0 && (
                  <>
                    <h4>Officers</h4>
                    <JobList jobs={officerJobs} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="help-ask">
        <section aria-labelledby="help-questions">
          <h2 id="help-questions" className="help-heading">
            Common questions
          </h2>
          <div className="help-questions">
            {QUESTIONS.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="help-support" aria-labelledby="help-support">
          <h2 id="help-support" className="section-title">
            Still stuck, or something looks wrong?
          </h2>
          <p className="text-muted">
            Ask in the support Discord. It reaches the people who run the Hub, and others may have hit the same thing.
          </p>
          <a className="button" href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
            Join the support Discord<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </section>
      </div>

      <section className="help-loot" id="loot-priority" aria-labelledby="help-loot">
        <h2 id="help-loot" className="help-heading">
          How Loot priority works
        </h2>
        <p className="text-muted">For teams that use the Loot priority system.</p>
        <ol className="help-flow">
          {LOOT_FLOW.map((stop) => (
            <li key={stop.who}>
              <span className="help-flow-who">{stop.who}</span>
              <b>{stop.title}</b>
              <span className="text-muted">{stop.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="help-band">
        <section aria-labelledby="help-setup">
          <h2 id="help-setup" className="help-heading">
            Bringing your guild here
          </h2>
          <p className="text-muted">
            For whoever runs the guild: from nothing to your first raid night. Joining a guild that’s already here? Just
            do step 1.
          </p>
          <ol className="help-setup">
            {SETUP.map((step) => (
              <li key={step.title}>
                <b>{step.title}</b>
                <span className="text-muted">{step.text}</span>
                <span className="help-links">
                  <GuideLink id={step.guide} />
                </span>
              </li>
            ))}
          </ol>
          <p className="text-muted help-also">
            Also for officers:{' '}
            {SETUP_ALSO.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && ' · '}
                <GuideLink id={id} />
              </Fragment>
            ))}
          </p>
        </section>

        <section className="help-index" aria-labelledby="help-index">
          <h2 id="help-index" className="section-title">
            All {GUIDES.length} guides
          </h2>
          <div className="help-topics">
            {TOPICS.map((topic) => (
              <div key={topic.id}>
                <h3>{topic.title}</h3>
                <ul className="help-links">
                  {GUIDES.filter((g) => g.topic === topic.id).map((g) => (
                    <li key={g.id}>
                      <GuideLink id={g.id} />
                      {g.officers && <span className="help-for-officers">Officers</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>

      {open && (
        <Dialog title={open.title} onClose={() => void navigate('/help')} side>
          <GuideBody guide={open} base={base} full={false} onToggle={() => setFull(true)} />
        </Dialog>
      )}
    </section>
  );
}

function GuideLink({ id }: { id: string }) {
  return <Link to={`/help/${id}`}>{guideById(id).title}</Link>;
}

function JobList({ jobs }: { jobs: WeekJob[] }) {
  return (
    <ul className="help-links">
      {jobs.map((job) =>
        typeof job === 'string' ? (
          <li key={job}>
            <GuideLink id={job} />
          </li>
        ) : (
          <li key={job.coming} className="text-muted">
            {job.coming}
            <span className="help-coming">guide coming</span>
          </li>
        )
      )}
    </ul>
  );
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
          srcSet={`/help-shots/menu-${guide.menu}.png 2x`}
          alt={`Step 1: ${MENUS[guide.menu]}.`}
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
      {guide.popup && (
        <img className="help-picture" srcSet={`/help-shots/${guide.id}-popup.png 2x`} alt={guide.popup} />
      )}
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
