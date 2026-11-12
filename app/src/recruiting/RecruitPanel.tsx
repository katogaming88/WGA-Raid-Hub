import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useSupabase } from '../data/DataProvider';
import { easternToday } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { characterLinks } from '../profile/profile';
import { classColor } from '../roster/roster';
import { ARCHIVE_REASONS } from '../roster/useNames';
import {
  age,
  answerText,
  eventText,
  isLink,
  notOnNeeds,
  recruiterNotes,
  sentBy,
  specClass,
  splitName,
  underMinimum,
  whereItsAt,
  type Answer,
  type Recruit,
  type RecruitList,
  type RecruitRecord
} from './recruits';
import type { SpecRow } from './recruiting';
import { useRecruitAction, useRecruitRecord, type Action } from './useRecruits';

// One recruit beside the list (#1549): who they are, what they sent, what has
// happened, the officers' notes, and the buttons. Mockup: page 7 of the
// recruitment canvas.
export function RecruitPanel({
  recruit,
  list,
  specs,
  backTo
}: {
  recruit: Recruit;
  list: RecruitList;
  specs: SpecRow[] | undefined;
  // Where "Applied before" links stay on this page.
  backTo: (id: number) => string;
}) {
  const record = useRecruitRecord(recruit.id);
  return (
    <section className="card rcs-panel" aria-label={`${recruit.name_realm}'s record`}>
      <DataState query={record} label="this recruit">
        {(rec) => <Panel key={recruit.id} recruit={recruit} list={list} specs={specs} rec={rec} backTo={backTo} />}
      </DataState>
    </section>
  );
}

function Panel({
  recruit: r,
  list,
  specs,
  rec,
  backTo
}: {
  recruit: Recruit;
  list: RecruitList;
  specs: SpecRow[] | undefined;
  rec: RecruitRecord;
  backTo: (id: number) => string;
}) {
  const now = new Date();
  const where = whereItsAt(r, now, easternToday());
  const { name, realm } = splitName(r.name_realm);
  const links = characterLinks(r.name_realm);
  const manage = list.access === 'manage';
  const writeNotes = list.access === 'manage' || list.access === 'note';
  const [whole, setWhole] = useState(false);
  const answers = whole ? rec.answers : rec.answers.slice(0, 2);
  const theirNotes = recruiterNotes(r, rec.notes);
  const officerNotes = rec.notes.filter((n) => !theirNotes.includes(n));
  const others = rec.other_specs.filter(Boolean);
  const before = rec.applied_before;
  const low = underMinimum(r, list.min_item_level);

  return (
    <>
      <div className="rcs-who">
        <h2 className="rcs-name" style={{ color: r.class_name ? classColor(r.class_name) : undefined }}>
          {name}
          {realm && <span className="rcs-realm">-{realm}</span>}
        </h2>
        <p className="text-muted rcs-line">
          {specClass(r) || 'Class not known'}
          {others.length > 0 && (
            <>
              {' '}
              {'·'} also {others.join(', ')}
            </>
          )}
        </p>
      </div>
      <p className="rcs-flags">
        <span className={`rcs-where rcs-where-${r.status}`}>
          {where.label}
          {where.detail && <span className="text-muted"> {where.detail}</span>}
        </span>
        {notOnNeeds(r, list.needs, specs) && <span className="text-muted">Not on your needs list</span>}
      </p>

      {theirNotes.length > 0 && (
        <div className="rcs-quote">
          <div className="text-dim rcs-small">
            Sent by {sentBy(r)} {'·'} their note, {age(theirNotes[theirNotes.length - 1]!.created_at, now)} ago
          </div>
          {theirNotes.map((n) => (
            <p key={n.id}>{n.body}</p>
          ))}
        </div>
      )}
      {theirNotes.length === 0 && <p className="text-dim rcs-small">Sent by {sentBy(r)}</p>}

      <dl className="rcs-stats">
        <Stat label="Item level" value={r.item_level} warn={low} />
        <Stat label="Mythic+ score" value={r.mplus_score !== null ? Number(r.mplus_score).toLocaleString() : null} />
        <Stat label="Best logs avg" value={r.logs_best_average} />
        <Stat label="Mythic bosses killed" value={r.mythic_bosses_killed} />
      </dl>
      {low && (
        <p className="rcs-small rcs-lowline">Under your {list.min_item_level} minimum. They can still be accepted.</p>
      )}

      <p className="rcs-links">
        {r.ticket_url && (
          <a href={r.ticket_url} target="_blank" rel="noopener noreferrer">
            Open their ticket<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
        {links && (
          <>
            <a href={links.warcraftLogs} target="_blank" rel="noopener noreferrer">
              Warcraft Logs<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <a href={links.raiderIo} target="_blank" rel="noopener noreferrer">
              Raider.IO<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <a href={links.armory} target="_blank" rel="noopener noreferrer">
              Armory<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </>
        )}
      </p>

      {rec.answers.length > 0 && (
        <div className="rcs-block">
          <h3 className="rcs-h3">Their answers</h3>
          {answers.map((a, i) => (
            <AnswerRow key={`${a.key ?? a.question_id ?? i}`} a={a} />
          ))}
          {rec.answers.length > 2 && (
            <button type="button" className="rcs-link" aria-expanded={whole} onClick={() => setWhole((w) => !w)}>
              {whole ? 'Show fewer answers' : 'See the whole application'}
            </button>
          )}
        </div>
      )}

      <div className="rcs-block">
        <h3 className="rcs-h3">What&rsquo;s happened</h3>
        <ol className="rcs-events" aria-label="History, newest first">
          {[...rec.events].reverse().map((e, i) => (
            <li key={i}>
              <span className="text-dim">{age(e.created_at, now)} ago</span>
              <span>{eventText(e)}</span>
            </li>
          ))}
        </ol>
      </div>

      {before.length > 0 && (
        <div className="rcs-block">
          <h3 className="rcs-h3">Applied before</h3>
          <ul className="rcs-before">
            {before.map((b) => (
              <li key={b.id}>
                {/* Only this team's own records open here; another team's
                    record is its own officers' to read. */}
                {b.team_name === rec.team_name ? <Link to={backTo(b.id)}>{b.team_name}</Link> : b.team_name}{' '}
                <span className="text-muted">
                  {'·'} {age(b.applied_at, now)} ago {'·'} {b.status.replace(/_/g, ' ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Conversation rec={rec} />

      <Notes rec={rec} notes={officerNotes} canWrite={writeNotes} />

      {manage && <Actions r={r} />}
      {!manage && (
        <p className="text-dim rcs-small">
          {list.access === 'note'
            ? 'You can add notes. Officers decide the rest.'
            : 'You can read this record. Officers decide the rest.'}
        </p>
      )}
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="rcs-stat">
      <dd className={warn ? 'rcs-warn' : undefined}>{value ?? '—'}</dd>
      <dt className="text-muted">{label}</dt>
    </div>
  );
}

function AnswerRow({ a }: { a: Answer }) {
  const text = answerText(a);
  return (
    <div className="rcs-qa">
      <div className="text-muted">{a.label}</div>
      <div>
        {a.answer_type === 'picture' && text ? (
          <Picture path={text} />
        ) : isLink(text) ? (
          <a href={text} target="_blank" rel="noopener noreferrer">
            {text}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : (
          text || <span className="text-dim">No answer</span>
        )}
      </div>
    </div>
  );
}

// A picture answer is a path in the private application-pictures bucket, so it
// is asked for with a short-lived link when someone chooses to look.
function Picture({ path }: { path: string }) {
  const client = useSupabase();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const show = async () => {
    const { data, error } = await client.storage.from('application-pictures').createSignedUrl(path, 300);
    if (error || !data) setFailed(true);
    else setUrl(data.signedUrl);
  };
  if (url) return <img className="rcs-picture" src={url} alt="What they attached" />;
  return (
    <>
      <button type="button" className="rcs-link" onClick={() => void show()}>
        Show their picture
      </button>
      {failed && <span className="form-error"> Couldn&rsquo;t load it.</span>}
    </>
  );
}

function Conversation({ rec }: { rec: RecruitRecord }) {
  if (!rec.messages.length) return null;
  const ticket = rec.messages.filter((m) => !m.in_officer_thread);
  const thread = rec.messages.filter((m) => m.in_officer_thread);
  const lines = (list: typeof ticket) => (
    <ul className="rcs-chat">
      {list.map((m, i) => (
        <li key={i}>
          <b>{m.author_name}</b> <span className="text-dim">{new Date(m.sent_at).toLocaleString()}</span>
          <div>
            {m.body}
            {m.attachments.map((f) => (
              <span key={f.name} className="text-dim">
                {' '}
                [{f.name}]
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <details className="rcs-block rcs-conversation">
      <summary>Saved conversation ({rec.messages.length} messages)</summary>
      {ticket.length > 0 && (
        <>
          <h4 className="rcs-h4">Their ticket</h4>
          {lines(ticket)}
        </>
      )}
      {thread.length > 0 && (
        <>
          <h4 className="rcs-h4">Officer thread</h4>
          {lines(thread)}
        </>
      )}
    </details>
  );
}

function Notes({ rec, notes, canWrite }: { rec: RecruitRecord; notes: RecruitRecord['notes']; canWrite: boolean }) {
  const id = useId();
  const act = useRecruitAction();
  const { announce } = useStatus();
  const [body, setBody] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    act.mutate(
      { kind: 'note', id: rec.id, body: body.trim() },
      {
        onSuccess: () => {
          setBody('');
          announce('success', 'Note added.');
        }
      }
    );
  };
  return (
    <div className="rcs-block">
      <h3 className="rcs-h3">
        Officer notes <span className="text-dim rcs-aside">(they never see these)</span>
      </h3>
      {notes.length > 0 && (
        <ul className="rcs-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="text-dim rcs-small">
                {n.author ?? 'Someone'}
                {n.source === 'discord' ? ' in Discord' : ''} {'·'} {new Date(n.created_at).toLocaleDateString()}
              </div>
              {n.body}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={submit} className="rcs-note-form">
          <label htmlFor={id} className="visually-hidden">
            Add a note
          </label>
          <textarea
            id={id}
            className="input"
            rows={2}
            maxLength={2000}
            value={body}
            placeholder="Add a note"
            onChange={(e) => setBody(e.target.value)}
          />
          <button type="submit" className="button" disabled={!body.trim() || act.isPending}>
            {act.isPending ? 'Adding…' : 'Add note'}
          </button>
          {act.isError && (
            <p className="form-error" role="alert">
              That did not save: {errorMessage(act.error)}
            </p>
          )}
        </form>
      )}
      {!canWrite && notes.length === 0 && <p className="text-dim rcs-small">No notes yet.</p>}
    </div>
  );
}

type Asking = 'decline' | 'extend' | 'not_joining' | null;

// The buttons the list also carries for someone on trial, and the open
// recruit's two: the same writes the Discord card does, on the same record.
export function Actions({ r, compact = false }: { r: Recruit; compact?: boolean }) {
  const act = useRecruitAction();
  const { announce } = useStatus();
  const [asking, setAsking] = useState<Asking>(null);
  const open = r.status === 'waiting_on_officers' || r.status === 'waiting_on_applicant';
  const reopenable = r.status === 'declined' || r.status === 'no_reply';
  const run = (a: Action, done: string) =>
    act.mutate(a, {
      onSuccess: () => {
        setAsking(null);
        announce('success', done);
      }
    });
  const cls = compact ? 'button rcs-small-button' : 'button';
  return (
    <div className="rcs-actions">
      <div className="rcs-buttons">
        {open && (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={act.isPending}
              onClick={() => run({ kind: 'start', id: r.id }, `${r.name_realm} is on trial.`)}
            >
              Start a trial
            </button>
            <button type="button" className="button" disabled={act.isPending} onClick={() => setAsking('decline')}>
              Decline
            </button>
          </>
        )}
        {r.status === 'on_trial' && (
          <>
            <button
              type="button"
              className={cls}
              disabled={act.isPending}
              onClick={() => run({ kind: 'joined', id: r.id }, `${r.name_realm} joined.`)}
            >
              Joined
            </button>
            <button type="button" className={cls} disabled={act.isPending} onClick={() => setAsking('extend')}>
              Extend trial
            </button>
            <button type="button" className={cls} disabled={act.isPending} onClick={() => setAsking('not_joining')}>
              Not joining
            </button>
          </>
        )}
        {reopenable && (
          <button
            type="button"
            className={cls}
            disabled={act.isPending}
            onClick={() => run({ kind: 'reopen', id: r.id }, `${r.name_realm} is open again.`)}
          >
            Reopen
          </button>
        )}
      </div>
      {act.isError && !asking && (
        <p className="form-error" role="alert">
          That did not go through: {errorMessage(act.error)}
        </p>
      )}
      {!compact && open && (
        <p className="text-dim rcs-small">
          The same buttons are on the card in their ticket. Start a trial adds them to the roster as a Trial; their
          ticket stays open until the trial ends.
        </p>
      )}
      {asking === 'decline' && (
        <ReasonDialog
          title={`Decline ${r.name_realm}`}
          label="Reason (optional)"
          help="Only officers see it, in the record's history."
          submit="Decline"
          required={false}
          pending={act.isPending}
          error={act.isError ? errorMessage(act.error) : null}
          onClose={() => setAsking(null)}
          onSubmit={(reason) => run({ kind: 'decline', id: r.id, reason }, `${r.name_realm} declined.`)}
        />
      )}
      {asking === 'extend' && (
        <ReasonDialog
          title={`Extend ${r.name_realm}'s trial`}
          label="Why is it extended?"
          help="Adds the team's trial length to the end date. Required."
          submit="Extend trial"
          required
          pending={act.isPending}
          error={act.isError ? errorMessage(act.error) : null}
          onClose={() => setAsking(null)}
          onSubmit={(reason) => run({ kind: 'extend', id: r.id, reason }, `${r.name_realm}'s trial is extended.`)}
        />
      )}
      {asking === 'not_joining' && (
        <NotJoiningDialog
          name={r.name_realm}
          pending={act.isPending}
          error={act.isError ? errorMessage(act.error) : null}
          onClose={() => setAsking(null)}
          onSubmit={(reason, detail) =>
            run({ kind: 'not_joining', id: r.id, reason, detail }, `${r.name_realm} is not joining.`)
          }
        />
      )}
    </div>
  );
}

function ReasonDialog({
  title,
  label,
  help,
  submit,
  required,
  pending,
  error,
  onClose,
  onSubmit
}: {
  title: string;
  label: string;
  help: string;
  submit: string;
  required: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const ok = !required || reason.trim().length > 0;
  return (
    <Dialog title={title} onClose={onClose} busy={pending}>
      <form
        className="rcs-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSubmit(reason.trim());
        }}
      >
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <textarea
          id={id}
          className="input"
          rows={3}
          maxLength={500}
          required={required}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-dim rcs-small">{help}</p>
        {error && (
          <p className="form-error" role="alert">
            That did not go through: {error}
          </p>
        )}
        <div className="rcs-buttons">
          <button type="button" className="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={!ok || pending}>
            {pending ? 'Saving…' : submit}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NotJoiningDialog({
  name,
  pending,
  error,
  onClose,
  onSubmit
}: {
  name: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string, detail: string) => void;
}) {
  const why = useId();
  const more = useId();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  return (
    <Dialog title={`${name} is not joining`} onClose={onClose} busy={pending}>
      <form
        className="rcs-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason) onSubmit(reason, detail.trim());
        }}
      >
        <label htmlFor={why} className="field-label">
          Why
        </label>
        <select id={why} className="input" value={reason} required onChange={(e) => setReason(e.target.value)}>
          <option value="">Pick a reason</option>
          {ARCHIVE_REASONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label htmlFor={more} className="field-label">
          More (optional)
        </label>
        <textarea
          id={more}
          className="input"
          rows={2}
          maxLength={500}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <p className="text-dim rcs-small">
          Takes their trial character off the roster, with this reason in its history.
        </p>
        {error && (
          <p className="form-error" role="alert">
            That did not go through: {error}
          </p>
        )}
        <div className="rcs-buttons">
          <button type="button" className="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={!reason || pending}>
            {pending ? 'Saving…' : 'Not joining'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
