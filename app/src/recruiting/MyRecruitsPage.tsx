import { useId, useState, type FormEvent } from 'react';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { useAddress } from '../data/address';
import { bothQueries } from '../data/query';
import { errorMessage } from '../lib/errors';
import { formatInstantDate, localTimeZoneNote } from '../lib/dates';
import { useRecruitingTeams } from '../apply/useApply';
import { classColor } from '../roster/roster';
import { NotFoundPage } from '../pages/NotFoundPage';
import { heading, links, needsOfficers, statusWord, subline, summary, type MyRecruit } from './myRecruits';
import { useAddMyNote, useMyRecruiterCode, useMyRecruits } from './useMyRecruits';
import './recruits.css';

// My recruits (#1550), under "You" for the guild's recruiters: their links and
// the people they sent. Mockup: page 8 of the recruitment canvas. Anyone who
// is not a recruiter here gets the not-found page, as for any page that is
// not theirs.
export function MyRecruitsPage() {
  const { guild } = useAddress();
  const code = useMyRecruiterCode(guild.id);
  const sent = useMyRecruits();
  const teams = useRecruitingTeams(guild.key);
  const loaded = bothQueries(bothQueries(code, sent), teams);
  return (
    <DataState query={loaded} label="your recruits">
      {([[mine, list], open]) =>
        mine === null ? (
          <NotFoundPage />
        ) : (
          <section className="page rcs-mine" aria-labelledby="page-title">
            <div className="page-header">
              <h1 id="page-title">My recruits</h1>
              <p className="text-muted page-subtitle">
                Send people your link. Anyone who applies through it shows up here with you as &ldquo;Sent by&rdquo;, so
                officers know who to ask.
              </p>
            </div>
            <Links
              guildKey={guild.key}
              code={mine}
              teams={open.filter((t) => t.taking_applications).map((t) => ({ name: t.name, slug: t.slug }))}
            />
            <People list={list.filter((r) => r.guild_id === guild.id)} />
          </section>
        )
      }
    </DataState>
  );
}

function Links({ guildKey, code, teams }: { guildKey: string; code: string; teams: { name: string; slug: string }[] }) {
  const { announce } = useStatus();
  const [copied, setCopied] = useState<string | null>(null);
  const all = links(window.location.origin, guildKey, code, teams);
  const copy = async (label: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(label);
      announce('success', `Copied the ${label} link.`);
    } catch {
      announce('error', 'Could not copy. Select the link and copy it by hand.');
    }
  };
  return (
    <section className="rcs-mine-block" aria-labelledby="rcs-links">
      <h2 id="rcs-links" className="section-title">
        Your links
      </h2>
      <ul className="rcs-links">
        {all.map((l) => (
          <li key={l.label}>
            <span className="rcs-link-label">{l.label}</span>
            <input className="input" readOnly value={l.url} aria-label={`${l.label} link`} />
            <button type="button" className="button" onClick={() => void copy(l.label, l.url)}>
              {copied === l.label ? 'Copied' : 'Copy'}
              <span className="visually-hidden"> {l.label} link</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-dim rcs-small">
        &ldquo;Not sure yet&rdquo; opens the guild&rsquo;s page with every team. You stay attached whichever team they
        pick.
      </p>
    </section>
  );
}

function People({ list }: { list: MyRecruit[] }) {
  const now = new Date();
  return (
    <section className="rcs-mine-block" aria-labelledby="rcs-people">
      <h2 id="rcs-people" className="section-title">
        People you sent
      </h2>
      <p className="text-muted rcs-small">
        {summary(list)}. {localTimeZoneNote()}
      </p>
      {list.length === 0 ? (
        <p className="text-muted">Nobody yet. Anyone who applies through one of your links will show up here.</p>
      ) : (
        <ul className="rcs-people">
          {list.map((r) => (
            <Person key={r.id} r={r} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Person({ r, now }: { r: MyRecruit; now: Date }) {
  const id = useId();
  const add = useAddMyNote();
  const { announce } = useStatus();
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    add.mutate(
      { id: r.id, body: body.trim() },
      {
        onSuccess: () => {
          setBody('');
          setOpen(false);
          announce('success', `Note saved for ${heading(r)}.`);
        }
      }
    );
  };
  return (
    <li className="rcs-person">
      <div className="rcs-person-head">
        <b style={{ color: r.class_name ? classColor(r.class_name) : undefined }}>{heading(r)}</b>
        <span className="text-muted">{subline(r, now)}</span>
        <span className={needsOfficers(r) ? 'rcs-waiting' : 'text-muted'}>{statusWord(r)}</span>
      </div>
      {r.notes.length > 0 && (
        <ul className="rcs-notes">
          {r.notes.map((n) => (
            <li key={n.id}>
              <div className="text-dim rcs-small">
                Your note {'\u00b7'} {formatInstantDate(n.created_at)}
              </div>
              {n.body}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form onSubmit={submit} className="rcs-note-form">
          <label htmlFor={id} className="field-label">
            Your note for {r.team_name}&rsquo;s officers
          </label>
          <textarea
            id={id}
            className="input"
            rows={2}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="rcs-note-actions">
            <button type="submit" className="button" disabled={!body.trim() || add.isPending}>
              {add.isPending ? 'Saving�' : 'Save note'}
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <p className="text-dim rcs-small">Shows on their application and in their ticket card.</p>
          {add.isError && (
            <p className="form-error" role="alert">
              That did not save: {errorMessage(add.error)}
            </p>
          )}
        </form>
      ) : (
        <button type="button" className="button" onClick={() => setOpen(true)}>
          {r.notes.length > 0 ? 'Add another note' : 'Add a note'}
          <span className="visually-hidden"> for {heading(r)}</span>
        </button>
      )}
    </li>
  );
}
