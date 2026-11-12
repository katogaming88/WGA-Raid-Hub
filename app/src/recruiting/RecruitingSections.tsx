import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { timeRange } from '../calendar/calendar';
import { WEEKDAY_NAMES } from '../calendar/schedule';
import {
  LANGUAGES,
  askSummary,
  draftAbout,
  type Heading,
  type SectionId,
  type Settings,
  type Spot,
  type SpecRow
} from './recruiting';

// The first four sections of Recruiting settings (#1548) and the wrapper every
// section uses. Mockup: page 6 of the recruitment canvas.

export type Set = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

// One of seven sections, open one at a time. The heading says where it stands:
// a tick when it is done, its number when not. A closed section stays mounted,
// hidden, so nothing typed in it is lost.
export function Section({
  id,
  number,
  title,
  heading,
  open,
  onToggle,
  help,
  children
}: {
  id: SectionId;
  number: number;
  title: string;
  heading: Heading;
  open: boolean;
  onToggle: (id: SectionId) => void;
  help: string;
  children: ReactNode;
}) {
  const uid = useId();
  const head = `${uid}-head`;
  const body = `${uid}-body`;
  return (
    <section className="card rec-section" data-section={id}>
      <h2 className="rec-heading" id={head}>
        <button type="button" aria-expanded={open} aria-controls={body} onClick={() => onToggle(id)}>
          <span className={`rec-mark${heading.done ? ' rec-mark-done' : ''}`} aria-hidden="true">
            {heading.done ? '✓' : number}
          </span>
          <span className="rec-title">{title}</span> <span className="text-dim rec-status">{heading.status}</span>{' '}
          <span className="visually-hidden">{heading.done ? ', done' : ', not done yet'}</span>
        </button>
      </h2>
      <div id={body} role="region" aria-labelledby={head} hidden={!open} className="rec-body">
        <p className="text-muted rec-help">{help}</p>
        {children}
      </div>
    </section>
  );
}

const asNumber = (text: string): number | null => (text.trim() === '' ? null : Number(text));

// ---------------------------------------------------------------------------
// 1. Recruiting

export function RecruitingSection({ s, set, team }: { s: Settings; set: Set; team: string }) {
  return (
    <>
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.taking_applications}
          onChange={(e) => set('taking_applications', e.target.checked)}
        />{' '}
        <b>Taking applications</b>
      </label>
      <p className="text-dim rec-note">
        {s.taking_applications
          ? `${team} shows Recruiting on its apply page, with the button below.`
          : `${team} shows Not recruiting and still shows how it raids. Open applications and trials carry on.`}
      </p>
      <fieldset className="rec-radios">
        <legend className="field-label">How people join</legend>
        <label>
          <input
            type="radio"
            name="join"
            checked={s.join_method === 'application'}
            onChange={() => set('join_method', 'application')}
          />{' '}
          <b>Application on Raid Hub</b>
          <span className="text-dim">
            {' '}
            They fill in your form; sending it adds them to the Discord and opens their ticket.
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="join"
            checked={s.join_method === 'discord_ticket'}
            onChange={() => set('join_method', 'discord_ticket')}
          />{' '}
          <b>Discord ticket only</b>
          <span className="text-dim">
            {' '}
            Your apply page shows everything below, with a button to your ticket instead of a form.
          </span>
        </label>
      </fieldset>
      {s.join_method === 'discord_ticket' && (
        <div className="field">
          <label className="field-label" htmlFor="rec-ticket-link">
            Link to your Discord ticket
          </label>
          <input
            id="rec-ticket-link"
            className="input"
            type="url"
            placeholder="https://discord.com/channels/..."
            value={s.ticket_link ?? ''}
            onChange={(e) => set('ticket_link', e.target.value.trim() === '' ? null : e.target.value)}
          />
        </div>
      )}
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.listed_on_guild_page}
          onChange={(e) => set('listed_on_guild_page', e.target.checked)}
        />{' '}
        <b>List on the guild's apply page</b>
      </label>
      <p className="text-dim rec-note">
        Turn off to recruit quietly: your own link still works, but {team} isn't shown with the other teams.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. About the team

const MAX_ABOUT = 2000;

// Wraps the selected text, or puts the marks where the cursor is. Markdown: the
// public page renders bold, italic, a heading, a list and a link.
function wrap(text: string, start: number, end: number, before: string, after: string, fallback: string) {
  const picked = text.slice(start, end) || fallback;
  const next = text.slice(0, start) + before + picked + after + text.slice(end);
  return { next, from: start + before.length, to: start + before.length + picked.length };
}

export function AboutSection({
  s,
  set,
  team,
  nights,
  spots,
  specs
}: {
  s: Settings;
  set: Set;
  team: string;
  nights: { weekday: number; is_optional: boolean }[];
  spots: Spot[];
  specs: SpecRow[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = s.about ?? '';
  const edit = (before: string, after: string, fallback: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const { next, from, to } = wrap(text, start, end, before, after, fallback);
    set('about', next);
    // After React puts the new text in, select what was wrapped.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from, to);
    });
  };
  const line = (mark: string, fallback: string) => {
    if (text === '') return set('about', mark + fallback);
    const start = ref.current?.selectionStart ?? text.length;
    const at = text.lastIndexOf('\n', start - 1) + 1;
    set('about', text.slice(0, at) + mark + text.slice(at));
  };
  return (
    <>
      <div className="rec-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="button" aria-label="Bold" onClick={() => edit('**', '**', 'bold text')}>
          <b>B</b>
        </button>
        <button type="button" className="button" aria-label="Italic" onClick={() => edit('*', '*', 'italic text')}>
          <i>I</i>
        </button>
        <button type="button" className="button" aria-label="Heading" onClick={() => line('# ', 'Heading')}>
          H
        </button>
        <button type="button" className="button" aria-label="Bulleted list" onClick={() => line('- ', 'Item')}>
          List
        </button>
        <button
          type="button"
          className="button"
          aria-label="Link"
          onClick={() => edit('[', '](https://)', 'link text')}
        >
          Link
        </button>
      </div>
      <textarea
        ref={ref}
        className="textarea"
        rows={8}
        aria-label="About the team"
        value={text}
        onChange={(e) => set('about', e.target.value === '' ? null : e.target.value)}
        aria-invalid={text.length > MAX_ABOUT ? true : undefined}
      />
      <div className="rec-aboutfoot">
        {text.trim() === '' && (
          <span className="text-dim">
            Stuck?{' '}
            <button
              type="button"
              className="rec-link"
              onClick={() => set('about', draftAbout(team, nights, spots, specs))}
            >
              Start from a draft
            </button>{' '}
            built from your raid nights and who you're looking for.
          </span>
        )}
        <span className={text.length > MAX_ABOUT ? 'form-error' : 'text-dim'}>
          {text.length.toLocaleString('en-US')} / {MAX_ABOUT.toLocaleString('en-US')}
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. How you raid

const radio = (name: string, current: string, options: [string, string][], pick: (v: string) => void) => (
  <div className="rec-segments">
    {options.map(([value, label]) => (
      <label key={value}>
        <input type="radio" name={name} checked={current === value} onChange={() => pick(value)} /> {label}
      </label>
    ))}
  </div>
);

export function RaidSection({
  s,
  set,
  nights,
  scheduleTo
}: {
  s: Settings;
  set: Set;
  nights: { weekday: number; start_time: string; duration_minutes: number; is_optional: boolean }[];
  scheduleTo: string;
}) {
  const [other, setOther] = useState('');
  const toggle = (lang: string, on: boolean) =>
    set('raid_languages', on ? [...s.raid_languages, lang] : s.raid_languages.filter((l) => l !== lang));
  const extras = s.raid_languages.filter((l) => !LANGUAGES.includes(l));
  const addOther = () => {
    const name = other.trim();
    if (name && !s.raid_languages.includes(name) && s.raid_languages.length < 5)
      set('raid_languages', [...s.raid_languages, name]);
    setOther('');
  };
  return (
    <>
      <h3 className="rec-sub">Schedule</h3>
      <div className="field">
        <span className="field-label">Raid nights</span>
        <p className="text-dim rec-note">
          From your raid schedule, so they never go out of date. Applicants see them in their own time zone.{' '}
          <Link to={scheduleTo}>Change the schedule</Link>
        </p>
        <ul className="rec-nights">
          {WEEKDAY_NAMES.map((day, i) => {
            const mine = nights.filter((n) => n.weekday === i);
            return (
              <li key={day}>
                <span className="rec-day">{day.slice(0, 3)}</span>
                {mine.length ? (
                  <span>
                    {mine
                      .map((n) => timeRange({ start: n.start_time, durationMinutes: n.duration_minutes }))
                      .join(', ')}
                    {mine.some((n) => n.is_optional) && <span className="text-dim"> (optional)</span>}
                  </span>
                ) : (
                  <span className="text-dim">-</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="rec-note">
          Schedule note
        </label>
        <input
          id="rec-note"
          className="input"
          maxLength={100}
          placeholder="A break, a moved night, an extra week"
          value={s.schedule_note ?? ''}
          onChange={(e) => set('schedule_note', e.target.value === '' ? null : e.target.value)}
        />
        <span className="field-hint">One line for anything unusual.</span>
      </div>
      <fieldset className="rec-radios">
        <legend className="field-label">Extra night early in a season</legend>
        {radio(
          'extra',
          s.extra_night,
          [
            ['none', "Don't show"],
            ['first_two_weeks', 'Yes, first 2 weeks'],
            ['sometimes', 'Sometimes']
          ],
          (v) => set('extra_night', v as Settings['extra_night'])
        )}
      </fieldset>

      <h3 className="rec-sub">What raiding with you is like</h3>
      <fieldset className="rec-radios">
        <legend className="field-label">Raid languages</legend>
        <p className="text-dim rec-note">What you speak on voice. The first you pick is your main one.</p>
        <div className="rec-segments">
          {LANGUAGES.map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                checked={s.raid_languages.includes(l)}
                onChange={(e) => toggle(l, e.target.checked)}
              />{' '}
              {l}
            </label>
          ))}
          {extras.map((l) => (
            <label key={l}>
              <input type="checkbox" checked onChange={() => toggle(l, false)} /> {l}
            </label>
          ))}
        </div>
        <div className="rec-inline">
          <label className="visually-hidden" htmlFor="rec-lang">
            Another language
          </label>
          <input
            id="rec-lang"
            className="input"
            maxLength={30}
            placeholder="Another language"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
          <button
            type="button"
            className="button"
            onClick={addOther}
            disabled={!other.trim() || s.raid_languages.length >= 5}
          >
            Add
          </button>
        </div>
      </fieldset>
      <fieldset className="rec-radios">
        <legend className="field-label">Split runs</legend>
        {radio(
          'split',
          s.split_runs,
          [
            ['none', 'No splits'],
            ['early_season', 'Early in a season'],
            ['weekly', 'Every week']
          ],
          (v) => set('split_runs', v as Settings['split_runs'])
        )}
      </fieldset>
      <div className="field">
        <label className="field-label" htmlFor="rec-alts">
          Alts expected
        </label>
        <input
          id="rec-alts"
          className="input rec-narrow"
          type="number"
          min={0}
          max={10}
          value={s.alts_expected ?? ''}
          onChange={(e) => set('alts_expected', asNumber(e.target.value))}
        />
        <span className="field-hint">How many geared alts you want raiders to keep. Leave empty to hide.</span>
      </div>
      <fieldset className="rec-radios">
        <legend className="field-label">PTR testing</legend>
        {radio(
          'ptr',
          s.ptr_testing,
          [
            ['none', 'No PTR testing'],
            ['optional', 'Optional'],
            ['expected', 'Expected']
          ],
          (v) => set('ptr_testing', v as Settings['ptr_testing'])
        )}
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. What you ask for

export function AskSection({ s, set }: { s: Settings; set: Set }) {
  return (
    <>
      <p className="text-dim rec-note">{askSummary(s)}</p>
      <div className="field">
        <label className="field-label" htmlFor="rec-ilvl">
          Lowest item level
        </label>
        <input
          id="rec-ilvl"
          className="input rec-narrow"
          type="number"
          min={1}
          max={1000}
          value={s.min_item_level ?? ''}
          onChange={(e) => set('min_item_level', asNumber(e.target.value))}
        />
        <span className="field-hint">Applicants below it can still apply; you see a warning on their application.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="rec-attend">
          Attendance you expect (%)
        </label>
        <input
          id="rec-attend"
          className="input rec-narrow"
          type="number"
          min={1}
          max={100}
          value={s.attendance_percent ?? ''}
          onChange={(e) => set('attendance_percent', asNumber(e.target.value))}
        />
      </div>
      <fieldset className="rec-radios">
        <legend className="field-label">Trial length</legend>
        {radio(
          'trial',
          String(s.trial_days),
          [
            ['7', '1 week'],
            ['14', '2 weeks'],
            ['28', '4 weeks']
          ],
          (v) => set('trial_days', Number(v))
        )}
        {![7, 14, 28].includes(s.trial_days) && <span className="text-dim">Now {s.trial_days} days.</span>}
      </fieldset>
      <label className="rec-check">
        <input type="checkbox" checked={s.logs_required} onChange={(e) => set('logs_required', e.target.checked)} />{' '}
        <b>This season's logs needed</b>
      </label>
      <div className="field">
        <label className="field-label" htmlFor="rec-else">
          Anything else
        </label>
        <input
          id="rec-else"
          className="input"
          maxLength={200}
          value={s.other_requirements ?? ''}
          onChange={(e) => set('other_requirements', e.target.value === '' ? null : e.target.value)}
        />
        <span className="field-hint">One line, shown under what you ask for.</span>
      </div>
    </>
  );
}
