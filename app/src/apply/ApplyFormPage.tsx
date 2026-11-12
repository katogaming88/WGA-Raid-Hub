import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DataState } from '../components/DataState';
import { useSupabase } from '../data/DataProvider';
import { BATTLENET, DISCORD, useSession } from '../auth/session';
import { useBattlenetCharacters } from '../characters/useCharacters';
import { pickerRows, type AccountCharacter, type CharactersAnswer } from '../characters/characters';
import { classColor } from '../roster/roster';
import { localTimeZone, nightInViewerZone } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { NotFoundPage } from '../pages/NotFoundPage';
import type { RecruitingTeam } from './apply';
import {
  belowItemLevel,
  classNote,
  fillPrompt,
  formQuestions,
  friendProblem,
  onTheList,
  otherSpecs,
  problems,
  sendableAnswers,
  sentByOf,
  startingSentBy,
  SENT_FRIEND,
  SENT_NOBODY,
  type Answers,
  type Question,
  type Recruiter
} from './form';
import { savedRecruiter } from './recruiterLink';
import {
  useActiveRecruiters,
  useApplicationForm,
  useCharacterStats,
  useClassSpecs,
  useSendApplication,
  type CharacterStats,
  type StatsAnswer
} from './useApplyForm';
import { useRecruitingTeams } from './useApply';
import { rememberPending } from './pending';
import './apply.css';

// /g/<guild>/apply/<team>/form (#1547): about five minutes. Pick a character,
// its numbers fill in, answer the team's questions, send. Mockup: page 3 of
// the recruitment canvas.
export function ApplyFormPage() {
  const { guildKey = '', applyTeam = '' } = useParams();
  const teams = useRecruitingTeams(guildKey, applyTeam);
  return (
    <DataState query={teams} label="this team">
      {(rows) => {
        const team = rows[0];
        // Not taking applications, or a ticket team: the team's own page says how to join.
        if (!team) return <NotFoundPage />;
        if (!team.taking_applications || team.join_method !== 'application')
          return <NoForm team={team} guildKey={guildKey} />;
        return <Form team={team} guildKey={guildKey} />;
      }}
    </DataState>
  );
}

function NoForm({ team, guildKey }: { team: RecruitingTeam; guildKey: string }) {
  return (
    <section className="page apply-page" aria-labelledby="page-title">
      <h1 id="page-title">{team.name} has no application form</h1>
      <p className="text-muted">
        {team.taking_applications ? 'This team takes people in its Discord.' : 'This team isn’t recruiting right now.'}
      </p>
      <p>
        <Link className="button" to={`/g/${guildKey}/apply/${team.slug}`}>
          Back to {team.name}
        </Link>
      </p>
    </section>
  );
}

function Form({ team, guildKey }: { team: RecruitingTeam; guildKey: string }) {
  const { user, signIn, connect, battlenetToken, refreshBattlenet } = useSession();
  const form = useApplicationForm(user ? team.team_id : undefined);
  const nights = team.nights
    .filter((n) => !n.is_optional)
    .map((n) => {
      const t = nightInViewerZone(n);
      return `${t.day}, ${t.time}`;
    })
    .join(' and ');

  const header = (
    <>
      <p className="text-dim apply-crumb">
        <Link to={`/g/${guildKey}/apply`}>Join us</Link> /{' '}
        <Link to={`/g/${guildKey}/apply/${team.slug}`}>{team.name}</Link> / Apply
      </p>
      <div className="page-header">
        <h1 id="page-title">Apply to {team.name}</h1>
        <p className="text-muted page-subtitle">
          About 5 minutes. Your gear, Mythic+ score and logs come from your character, so you don’t type them.
        </p>
      </div>
    </>
  );

  if (!user || !user.hasBattlenet || !battlenetToken) {
    return (
      <section className="page apply-page" aria-labelledby="page-title">
        {header}
        <div className="card apply-block">
          <h2 className="section-title">1. Your character</h2>
          <p className="text-muted">
            Battle.net needs to confirm it’s you before your characters can be read. Nothing is sent until you press
            Send application.
          </p>
          <div>
            {!user ? (
              <button type="button" className="button button-primary" onClick={() => void signIn(BATTLENET)}>
                Sign in with Battle.net
              </button>
            ) : user.hasBattlenet ? (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void refreshBattlenet('signup-character')}
              >
                Choose your character from Battle.net
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void connect(BATTLENET, 'signup-character')}
              >
                Connect Battle.net
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page apply-page" aria-labelledby="page-title">
      {header}
      <DataState query={form} label="the application form">
        {(f) => (
          <Picked
            team={team}
            guildKey={guildKey}
            questions={formQuestions(f)}
            nights={nights}
            token={battlenetToken}
            discord={user.hasDiscord}
            userId={user.id}
            onConnectDiscord={() => void connect(DISCORD, 'connect-discord')}
          />
        )}
      </DataState>
    </section>
  );
}

const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? null : n.toLocaleString('en-US', { maximumFractionDigits: digits });

function Stat({ label, value, failed }: { label: string; value: string | null; failed: boolean }) {
  return (
    <div className="apply-stat">
      <b>{failed ? 'Couldn’t load' : (value ?? '-')}</b>
      <span className="text-dim">{label}</span>
    </div>
  );
}

function Stats({ stats, character }: { stats: StatsAnswer | null; character: AccountCharacter }) {
  if (!stats) {
    return (
      <p className="text-muted" role="status">
        Reading {character.name}’s numbers…
      </p>
    );
  }
  const s: CharacterStats = stats.character;
  const down = (source: string) => (stats.failed as string[]).includes(source);
  const kills = s.mythic_bosses_killed;
  return (
    <div className="apply-stats">
      <Stat label="Item level" value={fmt(s.item_level ?? character.item_level)} failed={down('blizzard_profile')} />
      <Stat label="Mythic+ score" value={fmt(s.mplus_score)} failed={down('mythic_keystone')} />
      <Stat label="Best logs avg (Heroic)" value={fmt(s.heroic_logs?.best)} failed={down('warcraft_logs')} />
      <Stat
        label="Mythic bosses killed"
        value={kills ? `${kills.killed}/${kills.total}` : null}
        failed={down('warcraft_logs')}
      />
    </div>
  );
}

function Picked({
  team,
  guildKey,
  questions,
  nights,
  token,
  discord,
  userId,
  onConnectDiscord
}: {
  team: RecruitingTeam;
  guildKey: string;
  questions: Question[];
  nights: string;
  token: string;
  discord: boolean;
  userId: string;
  onConnectDiscord: () => void;
}) {
  const navigate = useNavigate();
  const list = useBattlenetCharacters();
  const statsCall = useCharacterStats();
  const send = useSendApplication();
  const recruiters = useActiveRecruiters(guildKey);
  const [answer, setAnswer] = useState<CharactersAnswer | null>(null);
  const [blizzardId, setBlizzardId] = useState<number | null>(null);
  const [stats, setStats] = useState<StatsAnswer | null>(null);
  const [specs, setSpecs] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [choice, setChoice] = useState<string | null>(null);
  const [friend, setFriend] = useState('');
  const [tried, setTried] = useState(false);
  const started = useRef<string | null>(null);
  const { mutate: read } = list;
  const { mutate: readStats } = statsCall;

  useEffect(() => {
    if (started.current === token) return;
    started.current = token;
    read({ token, allLevels: true }, { onSuccess: setAnswer });
  }, [token, read]);

  const rows = answer ? pickerRows(answer, new Map()) : [];
  const choosable = rows.filter((r) => r.kind === 'choose' || r.kind === 'yours').map((r) => r.character);
  const character = choosable.find((c) => c.blizzard_id === blizzardId) ?? null;
  const classSpecs = useClassSpecs(character?.class_name ?? null);

  const pick = (id: number) => {
    setBlizzardId(id);
    setStats(null);
    setSpecs([]);
    readStats({ token, blizzardId: id }, { onSuccess: setStats });
  };

  const recruiterList: Recruiter[] = recruiters.data ?? [];
  const sentChoice = choice ?? startingSentBy(recruiterList, savedRecruiter(guildKey));
  const fromLink = sentChoice !== SENT_FRIEND && sentChoice !== SENT_NOBODY && sentChoice === savedRecruiter(guildKey);

  const found = problems(questions, answers);
  const friendWhy = friendProblem(sentChoice, friend);
  const canSend = !!character && discord && Object.keys(found).length === 0 && !friendWhy;

  const onSend = () => {
    setTried(true);
    if (!canSend || !character || !answer) return;
    const by = sentByOf(sentChoice, friend);
    send.mutate(
      {
        teamId: team.team_id,
        blizzardId: character.blizzard_id,
        saved: answer.characters.filter((c) => c.saved).map((c) => c.blizzard_id),
        token,
        answers: sendableAnswers(questions, answers),
        recruiterCode: by.kind === 'recruiter' ? by.code : null,
        friendName: by.kind === 'friend' ? by.name : null,
        otherSpecs: specs,
        timeZone: localTimeZone()
      },
      {
        onSuccess: (sent) => {
          rememberPending(sent.id, `/g/${guildKey}/applications/${sent.id}`);
          if (sent.join.status === 'authorize') window.location.assign(sent.join.url);
          else void navigate(`/g/${guildKey}/applications/${sent.id}`);
        }
      }
    );
  };

  if (list.isError && !answer) {
    return (
      <p className="form-error" role="alert">
        Could not read your characters from Battle.net: {list.error.message}
      </p>
    );
  }
  if (!answer) {
    return (
      <p className="text-muted" role="status">
        Reading your characters from Battle.net…
      </p>
    );
  }

  const mainSpecs = classSpecs.data ?? [];
  const wanted = character ? onTheList(team.spots, character.class_name ?? '', character.spec_name, mainSpecs) : true;
  const others = character ? otherSpecs(mainSpecs, character.spec_name) : [];

  return (
    <form
      className="apply-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <section className="card apply-block" aria-labelledby="f-char">
        <h2 id="f-char" className="section-title">
          1. Your character
        </h2>
        <p className="text-dim apply-line">From your Battle.net account.</p>
        <div className="field">
          <label className="field-label" htmlFor="character">
            Character
          </label>
          <select
            id="character"
            className="input"
            value={blizzardId ?? ''}
            onChange={(e) => pick(Number(e.target.value))}
            aria-invalid={tried && !character ? true : undefined}
          >
            <option value="" disabled>
              Pick a character
            </option>
            {choosable.map((c) => (
              <option key={c.blizzard_id} value={c.blizzard_id}>
                {c.name} - {c.realm} ({[c.spec_name, c.class_name].filter(Boolean).join(' ')})
              </option>
            ))}
          </select>
          {tried && !character && <p className="form-error">Pick the character you’d raid on.</p>}
        </div>
        {character && (
          <>
            <Stats stats={stats} character={character} />
            {stats && belowItemLevel(team.min_item_level, stats.character.item_level ?? character.item_level) && (
              <p className="apply-note">
                {team.name} asks for item level {team.min_item_level}+. You can still apply; the officers will see this.
              </p>
            )}
            {!wanted && classSpecs.isSuccess && (
              <p className="apply-note">
                {classNote(team.name, character.class_name ?? '', team.exceptional_line !== null)}
              </p>
            )}
            {others.length > 0 && (
              <fieldset className="apply-choices">
                <legend className="field-label" style={{ color: classColor(character.class_name ?? '') }}>
                  Other specs you can play well
                </legend>
                {others.map((spec) => (
                  <label key={spec}>
                    <input
                      type="checkbox"
                      checked={specs.includes(spec)}
                      onChange={(e) => setSpecs(e.target.checked ? [...specs, spec] : specs.filter((s) => s !== spec))}
                    />{' '}
                    {spec}
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
      </section>

      <section className="card apply-block" aria-labelledby="f-about">
        <h2 id="f-about" className="section-title">
          2. About you
        </h2>
        <p className="text-dim apply-line">Anything marked optional can be skipped.</p>
        {questions.map((q) =>
          q.type === 'recruiter' ? (
            <SentBy
              key={q.key}
              question={q}
              team={team}
              recruiters={recruiterList}
              choice={sentChoice}
              onChoice={setChoice}
              fromLink={fromLink}
              friend={friend}
              onFriend={setFriend}
              friendProblem={tried ? friendWhy : null}
              nights={nights}
            />
          ) : (
            <QuestionField
              key={q.key}
              question={q}
              team={team}
              nights={nights}
              value={answers[q.key]}
              problem={tried ? (found[q.key] ?? null) : null}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
              userId={userId}
            />
          )
        )}
        <div className="field">
          <span className="field-label">Discord</span>
          {discord ? (
            <p className="apply-discord">
              <b>Linked.</b> When you send this, we add you to the team’s Discord and open your ticket with the
              officers. That’s why Discord asks to “join servers for you”.
            </p>
          ) : (
            <div className="apply-discord">
              <p>Link your Discord account first: the team’s officers talk to you there.</p>
              <button type="button" className="button" onClick={onConnectDiscord}>
                Connect Discord
              </button>
            </div>
          )}
        </div>
      </section>

      {send.isError && (
        <p className="form-error" role="alert">
          That didn’t send: {errorMessage(send.error)}
        </p>
      )}
      <div className="apply-send">
        <button
          type="submit"
          className="button button-primary"
          disabled={send.isPending}
          aria-disabled={send.isPending}
        >
          {send.isPending ? 'Sending…' : 'Send application'}
        </button>
        <span className="text-dim apply-line">
          Next: you land in the team’s Discord with your ticket open. We’ll DM you when an officer replies, and you can
          always check under My applications.
        </span>
      </div>
    </form>
  );
}

function Label({ q, htmlFor, team, nights }: { q: Question; htmlFor?: string; team: RecruitingTeam; nights: string }) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {fillPrompt(q.prompt, team.name, nights)}
      {!q.required && <span className="text-dim"> (optional)</span>}
    </label>
  );
}

function QuestionField({
  question: q,
  team,
  nights,
  value,
  problem,
  onChange,
  userId
}: {
  question: Question;
  team: RecruitingTeam;
  nights: string;
  value: string | boolean | undefined;
  problem: string | null;
  onChange: (v: string | boolean | undefined) => void;
  userId: string;
}) {
  const id = `q-${q.key}`;
  const text = typeof value === 'string' ? value : '';
  const err = problem ? (
    <p className="form-error" id={`${id}-err`}>
      {problem}
    </p>
  ) : null;
  const aria = { 'aria-invalid': problem ? true : undefined, 'aria-describedby': problem ? `${id}-err` : undefined };

  if (q.type === 'yes_no' || q.type === 'choice') {
    const options: [string, string | boolean][] =
      q.type === 'yes_no'
        ? [
            ['Yes', true],
            ['No', false]
          ]
        : q.choices.map((c) => [c, c]);
    return (
      <fieldset className="apply-choices" {...aria}>
        <legend className="field-label">
          {fillPrompt(q.prompt, team.name, nights)}
          {!q.required && <span className="text-dim"> (optional)</span>}
        </legend>
        {options.map(([label, v]) => (
          <label key={label}>
            <input type="radio" name={id} checked={value === v} onChange={() => onChange(v)} /> {label}
          </label>
        ))}
        {err}
      </fieldset>
    );
  }
  if (q.type === 'picture')
    return (
      <PictureField
        q={q}
        team={team}
        nights={nights}
        value={text}
        onChange={onChange}
        userId={userId}
        err={err}
        id={id}
      />
    );
  return (
    <div className="field">
      <Label q={q} htmlFor={id} team={team} nights={nights} />
      {q.type === 'paragraph' ? (
        <textarea
          id={id}
          className="textarea"
          rows={3}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={q.type === 'link' ? 'url' : 'text'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      )}
      {q.max !== null && (q.type === 'short_text' || q.type === 'paragraph') && (
        <span className="text-dim apply-counter" aria-live="off">
          {text.length} / {q.max}
        </span>
      )}
      {err}
    </div>
  );
}

// A picture answer goes straight to the private application-pictures bucket,
// under <team id>/<user id>/, with a fresh name each time: the bucket has no
// update rule (#1536's review). The answer is the path.
function PictureField({
  q,
  team,
  nights,
  value,
  onChange,
  userId,
  err,
  id
}: {
  q: Question;
  team: RecruitingTeam;
  nights: string;
  value: string;
  onChange: (v: string | undefined) => void;
  userId: string;
  err: React.ReactNode;
  id: string;
}) {
  const client = useSupabase();
  const [state, setState] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const upload = async (file: File) => {
    setState('uploading');
    const ext = /\.(png|jpe?g|gif|webp)$/i.exec(file.name)?.[1]?.toLowerCase() ?? 'png';
    const path = `${team.team_id}/${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await client.storage.from('application-pictures').upload(path, file, { upsert: false });
    if (error) {
      setState('failed');
      onChange(undefined);
      return;
    }
    setState('idle');
    onChange(path);
  };
  return (
    <div className="field">
      <Label q={q} htmlFor={id} team={team} nights={nights} />
      <input
        id={id}
        className="input"
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
      />
      {state === 'uploading' && (
        <p className="text-dim apply-line" role="status">
          Uploading…
        </p>
      )}
      {state === 'failed' && <p className="form-error">That picture didn’t upload (images up to 5 MB). Try another.</p>}
      {value && state === 'idle' && <p className="text-dim apply-line">Picture added.</p>}
      {err}
    </div>
  );
}

function SentBy({
  question: q,
  team,
  recruiters,
  choice,
  onChoice,
  fromLink,
  friend,
  onFriend,
  friendProblem: why,
  nights
}: {
  question: Question;
  team: RecruitingTeam;
  recruiters: Recruiter[];
  choice: string;
  onChoice: (v: string) => void;
  fromLink: boolean;
  friend: string;
  onFriend: (v: string) => void;
  friendProblem: string | null;
  nights: string;
}) {
  return (
    <div className="field">
      <Label q={q} htmlFor="sent-by" team={team} nights={nights} />
      <select id="sent-by" className="input" value={choice} onChange={(e) => onChoice(e.target.value)}>
        {recruiters.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
        <option value={SENT_FRIEND}>A friend in the guild</option>
        <option value={SENT_NOBODY}>Nobody, I found you myself</option>
      </select>
      {fromLink && <span className="text-dim apply-line">Already picked because you came from their link.</span>}
      {choice === SENT_FRIEND && (
        <div className="field">
          <label className="field-label" htmlFor="friend">
            Who’s your friend?
          </label>
          <input
            id="friend"
            className="input"
            maxLength={100}
            placeholder="Their character or Discord name"
            value={friend}
            onChange={(e) => onFriend(e.target.value)}
            aria-invalid={why ? true : undefined}
          />
          <span className="text-dim apply-line">Officers will ask them about you.</span>
          {why && <p className="form-error">{why}</p>}
        </div>
      )}
    </div>
  );
}
