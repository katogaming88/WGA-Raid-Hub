import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { bothQueries } from '../data/query';
import { useAddress, useTeam } from '../data/address';
import { useScheduleEditor } from '../calendar/useSchedule';
import { errorMessage } from '../lib/errors';
import type { Bases } from '../help/guide';
import {
  SECTIONS,
  changes,
  headings,
  ownDraftOf,
  problems,
  sameQuestions,
  sameSpots,
  sameStarters,
  spotRows,
  spotsOf,
  startersOf,
  type Draft,
  type SectionId,
  type Settings
} from './recruiting';
import { AboutSection, AskSection, RaidSection, RecruitingSection, Section, type Set } from './RecruitingSections';
import { QuestionsSection, SpotsSection } from './QuestionsAndSpots';
import { DiscordSection } from './DiscordSection';
import { useQuestionList, useRecruitingSettings, useSaveRecruiting, useSpecs } from './useRecruiting';
import './recruiting.css';

// Settings for a team's recruiting (#1548), in the Officer menu's Recruiting
// group: whether the team takes applications, what its public apply page says,
// what applicants are asked, who it needs and what the bot does in Discord.
// Seven sections, open one at a time, and one save bar for all of them.
// Mockup: page 6 of the recruitment canvas.
export function RecruitingSettingsPage() {
  const team = useTeam();
  const settings = useRecruitingSettings(team.id);
  const questions = useQuestionList(team.id);
  const specs = useSpecs();
  const schedule = useScheduleEditor(team.id, true);
  const loaded = bothQueries(bothQueries(settings, questions), bothQueries(specs, schedule));

  return (
    <section className="page settings-page rec-page" aria-labelledby="page-title">
      <PageHead />
      <DataState query={loaded} label="recruiting settings">
        {([[saved, list], [allSpecs, sched]]) => (
          // Keyed by what the database holds, so after a save the draft is
          // built again from it.
          <Editor
            key={JSON.stringify([saved, list])}
            teamId={team.id}
            teamName={team.name}
            saved={saved}
            list={list}
            specs={allSpecs}
            nights={sched.nights.filter((n) => n.active)}
          />
        )}
      </DataState>
    </section>
  );
}

function PageHead() {
  const { guild, team } = useAddress();
  return (
    <div className="page-header rec-head">
      <div>
        <h1 id="page-title">Recruiting settings</h1>
        <p className="text-muted page-subtitle">
          {team?.name}'s public apply page, and what happens when someone applies.{' '}
          <Link to="/help/recruiting-settings">Help guide</Link>
        </p>
      </div>
      {team && (
        <Link className="button" to={`/g/${guild.key}/apply/${team.key}`}>
          See your apply page
        </Link>
      )}
    </div>
  );
}

function Editor({
  teamId,
  teamName,
  saved,
  list,
  specs,
  nights
}: {
  teamId: number;
  teamName: string;
  saved: ReturnType<typeof useRecruitingSettings>['data'] & object;
  list: ReturnType<typeof useQuestionList>['data'] & object;
  specs: ReturnType<typeof useSpecs>['data'] & object;
  nights: { weekday: number; start_time: string; duration_minutes: number; is_optional: boolean }[];
}) {
  const base = useOutletContext<Bases>();
  const { announce } = useStatus();
  const save = useSaveRecruiting();
  const [initial] = useState<Draft>(() => ({
    settings: saved.settings,
    spots: spotsOf(saved.spots),
    starters: startersOf(list.starters),
    questions: list.questions.map(ownDraftOf)
  }));
  const [draft, setDraft] = useState<Draft>(initial);
  const [open, setOpen] = useState<SectionId | null>('recruiting');

  const set: Set = (key, value) => setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } as Settings }));
  const diff = changes(saved.settings, draft.settings);
  const spotsChanged = !sameSpots(initial.spots, draft.spots);
  const questionsChanged =
    !sameStarters(initial.starters, draft.starters) || !sameQuestions(initial.questions, draft.questions);
  const dirty = Object.keys(diff).length > 0 || spotsChanged || questionsChanged;
  const why = dirty ? problems(draft) : [];
  const heads = headings(draft, nights.length);

  const onSave = () => {
    if (!dirty || why.length) return;
    save.mutate(
      {
        teamId,
        changes: Object.keys(diff).length ? diff : null,
        spots: spotsChanged ? spotRows(draft.spots) : null,
        questions: questionsChanged ? { starters: draft.starters, own: draft.questions } : null
      },
      { onSuccess: () => announce('success', 'Recruiting settings saved.') }
    );
  };
  const discard = () => setDraft(initial);
  const toggle = (id: SectionId) => setOpen((o) => (o === id ? null : id));
  const sp = (id: SectionId) => ({
    id,
    number: SECTIONS.indexOf(id) + 1,
    heading: heads[id],
    open: open === id,
    onToggle: toggle
  });
  const s = draft.settings;

  return (
    <form className="rec-form" onSubmit={(e) => e.preventDefault()}>
      <Section
        {...sp('recruiting')}
        title="Recruiting"
        help={`Whether ${teamName} is taking applications, and how people reach you.`}
      >
        <RecruitingSection s={s} set={set} team={teamName} />
      </Section>
      <Section
        {...sp('about')}
        title="About the team"
        help="Who you are and why someone should raid with you. This is the first thing on your apply page."
      >
        <AboutSection s={s} set={set} team={teamName} nights={nights} spots={draft.spots} specs={specs} />
      </Section>
      <Section
        {...sp('raid')}
        title="How you raid"
        help='The quick facts applicants check first. They show under "How we raid" on your apply page.'
      >
        <RaidSection s={s} set={set} nights={nights} scheduleTo={`${base.team}/calendar`} />
      </Section>
      <Section
        {...sp('ask')}
        title="What you ask for"
        help="Shown on your apply page. Applicants below the item level can still apply; you see a warning on their application."
      >
        <AskSection s={s} set={set} />
      </Section>
      <Section
        {...sp('questions')}
        title="Application questions"
        help={'Only used with "Application on Raid Hub". Grey text is exactly what applicants see.'}
      >
        <QuestionsSection
          starters={list.starters}
          answers={draft.starters}
          onStarter={(key, value) => setDraft((d) => ({ ...d, starters: { ...d.starters, [key]: value } }))}
          own={draft.questions}
          onOwn={(questions) => setDraft((d) => ({ ...d, questions }))}
          joinsByForm={s.join_method === 'application'}
        />
      </Section>
      <Section {...sp('looking')} title="Who you're looking for" help="Pick the specs you need, and how much.">
        <SpotsSection
          spots={draft.spots}
          onSpots={(spots) => setDraft((d) => ({ ...d, spots }))}
          specs={specs}
          s={s}
          set={set}
        />
      </Section>
      <Section
        {...sp('discord')}
        title="Discord"
        help="What the bot does in your Discord when someone applies. Their application, notes and history are on Raid Hub whichever you pick."
      >
        <DiscordSection teamId={teamId} s={s} set={set} base={base.team} />
      </Section>

      {/* Always mounted, with its buttons greyed until something changes, so
          nothing above it moves. */}
      <div className="card rec-savebar pinned-save-bar">
        <div className="rec-savetext">
          <span role="status">
            {save.isPending ? 'Saving…' : dirty ? 'You have unsaved changes.' : 'No unsaved changes.'}
          </span>
          {why.length > 0 && (
            <ul className="rec-problems" aria-label="Fix before saving">
              {why.slice(0, 3).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {why.length > 3 && <li>and {why.length - 3} more.</li>}
            </ul>
          )}
        </div>
        <button type="button" className="button" disabled={!dirty || save.isPending} onClick={discard}>
          Discard
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!dirty || save.isPending || why.length > 0}
          onClick={onSave}
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          That did not save: {errorMessage(save.error)}
        </p>
      )}
    </form>
  );
}
