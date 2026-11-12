import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DataState } from '../components/DataState';
import { useSession } from '../auth/session';
import { formatInstantDate, localTimeZoneNote } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { defaultGuildPath } from '../config';
import { NotFoundPage } from '../pages/NotFoundPage';
import { applicationFacts, isOpen, STATUS_LABELS, steps, type Step } from './applications';
import { forgetPending, pendingApplication } from './pending';
import { useFinishDiscordJoin, useMyApplications, useWithdrawApplication, type MyApplication } from './useApplyForm';
import './apply.css';

// The after-send page, My applications and the page Discord sends the
// applicant back to (#1547). Mockup: page 4 of the recruitment canvas.

function SignedOutNote() {
  const { signIn } = useSession();
  return (
    <section className="page apply-page" aria-labelledby="page-title">
      <h1 id="page-title">My applications</h1>
      <p className="text-muted">Sign in to see the applications you’ve sent.</p>
      <div>
        <button type="button" className="button button-primary" onClick={() => void signIn('custom:battlenet')}>
          Sign in with Battle.net
        </button>
      </div>
    </section>
  );
}

function Progress({ list }: { list: Step[] }) {
  return (
    <ol className="apply-steps">
      {list.map((s, i) => (
        <li
          key={s.label}
          className={`apply-step apply-step-${s.state}`}
          aria-current={s.state === 'now' ? 'step' : undefined}
        >
          <span className="apply-dot" aria-hidden="true">
            {s.state === 'done' ? '✓' : i + 1}
          </span>
          <div>
            <div className="apply-step-label">{s.label}</div>
            {s.note && <div className="text-dim apply-line">{s.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// "Open my ticket in Discord" is a button, never an automatic redirect: a
// redirect skips this page, and a browser opens Discord's website, a login
// screen for anyone not signed in there. It shows only once the ticket exists,
// since the link opened any earlier lands on Discord's "no access" screen.
function TicketButton({ app }: { app: MyApplication }) {
  if (app.ticket_url) {
    return (
      <a className="button button-primary" href={app.ticket_url} target="_blank" rel="noopener noreferrer">
        Open my ticket in Discord
      </a>
    );
  }
  if (!isOpen(app) || app.add_to_server === false) return null;
  return (
    <span className="text-muted" role="status">
      Setting up your ticket…
    </span>
  );
}

function Withdraw({ app }: { app: MyApplication }) {
  const withdraw = useWithdrawApplication();
  const [asking, setAsking] = useState(false);
  if (!isOpen(app) || app.status === 'on_trial') return null;
  return (
    <div className="apply-withdraw">
      {asking ? (
        <>
          <span>Withdraw this application?</span>
          <button
            type="button"
            className="button button-danger"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(app.id)}
          >
            {withdraw.isPending ? 'Withdrawing…' : 'Yes, withdraw'}
          </button>
          <button type="button" className="button" onClick={() => setAsking(false)}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" className="button" onClick={() => setAsking(true)}>
          Withdraw
        </button>
      )}
      {withdraw.isError && (
        <p className="form-error" role="alert">
          {errorMessage(withdraw.error)}
        </p>
      )}
    </div>
  );
}

function ApplicationCard({ app, headingLevel = 2 }: { app: MyApplication; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <section className="card apply-block" aria-label={`${app.team_name} application`}>
      <div className="apply-card-head">
        <H className="section-title">{app.team_name}</H>
        <span className={isOpen(app) ? 'apply-status apply-open' : 'apply-status text-dim'}>
          {STATUS_LABELS[app.status] ?? app.status}
        </span>
      </div>
      <p className="text-dim apply-line">{applicationFacts(app, formatInstantDate)}</p>
      <Progress list={steps(app)} />
      {app.join_failed && !app.ticket_url && (
        <p className="apply-note">
          We couldn’t add you to the Discord. The officers have been told and will reach out, or ask in the team’s
          Discord.
        </p>
      )}
    </section>
  );
}

// /g/<guild>/applications/<id>: right after sending, and from My applications.
export function ApplicationPage() {
  const { guildKey = '', applicationId = '' } = useParams();
  const { user } = useSession();
  const mine = useMyApplications(!!user);
  const { refetch } = mine;
  const app = mine.data?.find((a) => a.id === Number(applicationId));
  // The ticket is made a moment after sending, so look again while it isn't there.
  const waiting = !!app && isOpen(app) && app.add_to_server !== false && !app.ticket_url && !app.join_failed;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refetch(), 5000);
    return () => clearInterval(timer);
  }, [waiting, refetch]);

  if (!user) return <SignedOutNote />;
  return (
    <DataState query={mine} label="your application">
      {() =>
        !app ? (
          <NotFoundPage />
        ) : (
          <section className="page apply-page" aria-labelledby="page-title">
            <p className="text-dim apply-crumb">
              You / <Link to={`/g/${guildKey}/applications`}>My applications</Link>
            </p>
            <div className="page-header">
              <h1 id="page-title">
                {app.ticket_url && isOpen(app)
                  ? 'You’re in our Discord. Say hi in your ticket.'
                  : `Your application to ${app.team_name}`}
              </h1>
              {app.ticket_url && isOpen(app) && (
                <p className="text-muted page-subtitle">
                  We added you to the Discord and opened a private ticket with {app.team_name}’s officers. Check your
                  Discord DMs for a link straight to it. Your application is already posted there, so you don’t need to
                  repeat anything.
                </p>
              )}
            </div>
            <div className="apply-actions">
              <TicketButton app={app} />
              <Link className="button" to={`/g/${app.guild_key}/apply/${app.team_slug}`}>
                Back to {app.team_name}
              </Link>
            </div>
            {app.ticket_url && isOpen(app) && (
              <p className="text-dim apply-line">
                Lost it later? Press <b>Find my ticket</b> in the Discord’s applications channel.
              </p>
            )}
            <ApplicationCard app={app} />
            <Withdraw app={app} />
            <p className="text-dim apply-line">{localTimeZoneNote()}</p>
          </section>
        )
      }
    </DataState>
  );
}

// /g/<guild>/applications: everything the person has sent.
export function MyApplicationsPage() {
  const { guildKey = '' } = useParams();
  const { user } = useSession();
  const mine = useMyApplications(!!user);
  if (!user) return <SignedOutNote />;
  return (
    <section className="page apply-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">My applications</h1>
        <p className="text-muted page-subtitle">Where each application stands. You can withdraw one while it’s open.</p>
      </div>
      <DataState query={mine} label="your applications">
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-muted">
              You haven’t applied anywhere yet. <Link to={`/g/${guildKey}/apply`}>See who’s recruiting</Link>.
            </p>
          ) : (
            <ul className="apply-list">
              {rows.map((a) => (
                <li key={a.id}>
                  <ApplicationCard app={a} />
                  <div className="apply-actions apply-under">
                    <TicketButton app={a} />
                    <Link className="button" to={`/g/${a.guild_key}/applications/${a.id}`}>
                      Open
                    </Link>
                    <Withdraw app={a} />
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </DataState>
      <p className="text-dim apply-line">{localTimeZoneNote()}</p>
    </section>
  );
}

// /apply/discord: Discord sends the applicant back here with a code and the
// signed state (#1540). The code is handed over once, signed in as them.
export function DiscordReturnPage() {
  const [params] = useSearchParams();
  const { user } = useSession();
  const finish = useFinishDiscordJoin();
  const { mutate } = finish;
  const state = params.get('state');
  const code = params.get('code');
  const error = params.get('error');
  const done = useRef(false);
  const pending = pendingApplication();

  useEffect(() => {
    if (done.current || !user || !state) return;
    done.current = true;
    mutate({ state, code, error });
  }, [user, state, code, error, mutate]);

  const where = pending?.path ?? defaultGuildPath();
  const onward = (
    <p>
      <Link className="button button-primary" to={where} onClick={forgetPending}>
        {pending ? 'See your application' : 'Continue'}
      </Link>
    </p>
  );

  if (!state) {
    return (
      <section className="page apply-page" aria-labelledby="page-title">
        <h1 id="page-title">Nothing to finish here</h1>
        <p className="text-muted">This page is where Discord sends you after you agree to join the server.</p>
        {onward}
      </section>
    );
  }
  if (!user) return <SignedOutNote />;
  return (
    <section className="page apply-page" aria-labelledby="page-title">
      <h1 id="page-title">Joining the Discord</h1>
      {finish.isPending || finish.isIdle ? (
        <p className="text-muted" role="status">
          Adding you to the server…
        </p>
      ) : finish.isError ? (
        <>
          <p className="form-error" role="alert">
            That didn’t finish: {errorMessage(finish.error)}
          </p>
          <p className="text-muted">Your application is sent. The officers can add you themselves.</p>
          {onward}
        </>
      ) : finish.data.status === 'failed' ? (
        <>
          <p className="apply-note">
            Discord wouldn’t add you automatically. The officers have been told.
            {finish.data.invite ? ' Use this invite to join yourself:' : ''}
          </p>
          {finish.data.invite && (
            <p>
              <a className="button" href={finish.data.invite} target="_blank" rel="noopener noreferrer">
                Join the Discord
              </a>
            </p>
          )}
          {onward}
        </>
      ) : (
        <>
          <p className="text-muted">You’re in the server. Your ticket is on its way.</p>
          {onward}
        </>
      )}
    </section>
  );
}
