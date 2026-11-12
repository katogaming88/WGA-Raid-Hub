import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useAddress, useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { easternToday } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { classColor } from '../roster/roster';
import { Actions, RecruitPanel } from './RecruitPanel';
import {
  NAME_REALM,
  TABS,
  inTab,
  notOnNeeds,
  sentBy,
  specClass,
  splitName,
  tabCounts,
  tabOf,
  underMinimum,
  whereItsAt,
  type Recruit,
  type RecruitList,
  type TabId
} from './recruits';
import type { SpecRow } from './recruiting';
import { useAddRecruit, useTeamRecruits } from './useRecruits';
import { useSpecs } from './useRecruiting';
import './recruits.css';

// Everyone who applied to or trialed with a team, in one place (#1549), in the
// Officer menu's Recruiting group. A tab per stage, the list, and the chosen
// recruit's record beside it. Mockup: page 7 of the recruitment canvas.
export function RecruitsPage() {
  const team = useTeam();
  const list = useTeamRecruits(team.id);
  // Open to anyone: which class plays which role, for the needs-list note.
  const specs = useSpecs();
  const loaded = bothQueries(list, specs);
  return (
    <section className="page rcs-page" aria-labelledby="page-title">
      <div className="page-header rcs-head">
        <div>
          <h1 id="page-title">Recruits</h1>
          <p className="text-muted page-subtitle">
            Everyone who applied to {team.name} or is trying out, and where each one stands.{' '}
            <Link to="/help/recruits">Help guide</Link>
          </p>
        </div>
        <AddRecruit teamId={team.id} />
      </div>
      <DataState query={loaded} label="recruits">
        {([data, allSpecs]) => <Body list={data} specs={allSpecs} />}
      </DataState>
    </section>
  );
}

function Body({ list, specs }: { list: RecruitList; specs: SpecRow[] }) {
  const [params] = useSearchParams();
  const tab = tabOf(params.get('tab'));
  const counts = tabCounts(list.recruits);
  const shown = list.recruits.filter((r) => inTab(r, tab));
  const wanted = Number(params.get('recruit'));
  // A recruit named in the address wins, whatever tab it is in; otherwise the
  // first of the tab.
  const chosen = list.recruits.find((r) => r.id === wanted) ?? shown[0] ?? null;
  const link = (t: TabId, id?: number) => `?tab=${t}${id ? `&recruit=${id}` : ''}`;
  const chosenTab = chosen ? (TABS.find((t) => inTab(chosen, t.id))?.id ?? tab) : tab;

  return (
    <>
      <nav className="rcs-tabs" aria-label="Recruit status">
        {TABS.map((t) => (
          <Link key={t.id} to={link(t.id)} aria-current={t.id === tab ? 'page' : undefined}>
            {t.label} <span className="text-dim">{counts[t.id]}</span>
          </Link>
        ))}
      </nav>
      <div className="rcs-layout">
        <div className="rcs-list">
          {shown.length === 0 ? (
            <p className="text-muted rcs-empty">{EMPTY[tab]}</p>
          ) : (
            <List
              recruits={shown}
              list={list}
              specs={specs}
              tab={tab}
              chosen={chosen?.id ?? null}
              to={(id) => link(tab, id)}
            />
          )}
          {tab === 'open' && shown.length > 0 && (
            <p className="text-dim rcs-small rcs-legend">
              &ldquo;Waiting on officers&rdquo; means they wrote last. Logs are their best average. Orange item level is
              under your minimum.
            </p>
          )}
        </div>
        {chosen && (
          <RecruitPanel
            key={chosen.id}
            recruit={chosen}
            list={list}
            specs={specs}
            backTo={(id) => link(chosenTab, id)}
          />
        )}
      </div>
    </>
  );
}

const EMPTY: Record<TabId, string> = {
  open: 'Nobody is waiting on an answer right now.',
  trial: 'Nobody is on trial.',
  joined: 'Nobody has joined through a recruit record yet.',
  declined: 'Nobody has been declined, or backed out.',
  noreply: 'No ticket has closed for lack of a reply.'
};

function List({
  recruits,
  list,
  specs,
  tab,
  chosen,
  to
}: {
  recruits: Recruit[];
  list: RecruitList;
  specs: SpecRow[];
  tab: TabId;
  chosen: number | null;
  to: (id: number) => string;
}) {
  const now = new Date();
  const today = easternToday();
  const trial = tab === 'trial';
  return (
    <div className="rcs-table-wrap">
      <table className="rcs-table">
        <thead>
          <tr>
            <th scope="col">Recruit</th>
            <th scope="col">Spec</th>
            <th scope="col" className="rcs-num">
              Item level
            </th>
            <th scope="col" className="rcs-num">
              Logs
            </th>
            <th scope="col">Where it&rsquo;s at</th>
            <th scope="col">Sent by</th>
            {trial && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {recruits.map((r) => {
            const { name, realm } = splitName(r.name_realm);
            const where = whereItsAt(r, now, today);
            return (
              <tr key={r.id} className={r.id === chosen ? 'rcs-selected' : undefined}>
                <td>
                  <Link
                    to={to(r.id)}
                    className="rcs-recruit"
                    aria-current={r.id === chosen ? 'true' : undefined}
                    style={{ color: r.class_name ? classColor(r.class_name) : undefined }}
                  >
                    {name}
                  </Link>{' '}
                  {realm && <span className="text-dim">{realm}</span>}
                  {notOnNeeds(r, list.needs, specs) && <div className="text-dim rcs-small">Not on your needs list</div>}
                </td>
                <td>{specClass(r) || '—'}</td>
                <td className={`rcs-num${underMinimum(r, list.min_item_level) ? ' rcs-warn' : ''}`}>
                  {r.item_level ?? '—'}
                </td>
                <td className="rcs-num">{r.logs_best_average ?? '—'}</td>
                <td>
                  <span className={`rcs-where rcs-where-${r.status}`}>{where.label}</span>
                  {where.detail && <span className="text-muted"> {where.detail}</span>}
                </td>
                <td>{sentBy(r)}</td>
                {trial && (
                  <td>
                    {list.access === 'manage' ? <Actions r={r} compact /> : <span className="text-dim">{'—'}</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// For a team that takes people through a Discord ticket instead of the form:
// a record by character, so they get one too.
function AddRecruit({ teamId }: { teamId: number }) {
  const list = useTeamRecruits(teamId);
  const [, setParams] = useSearchParams();
  const add = useAddRecruit(teamId);
  const { announce } = useStatus();
  const { team } = useAddress();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const id = useId();
  if (list.data?.access !== 'manage') return null;
  const value = name.trim();
  const ok = NAME_REALM.test(value);
  const close = () => {
    setOpen(false);
    setName('');
    add.reset();
  };
  return (
    <>
      <button type="button" className="button" onClick={() => setOpen(true)}>
        Add a recruit
      </button>
      {open && (
        <Dialog title="Add a recruit" onClose={close} busy={add.isPending}>
          <form
            className="rcs-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ok) return;
              add.mutate(value, {
                onSuccess: (newId) => {
                  announce('success', `${value} added.`);
                  close();
                  setParams({ tab: 'open', recruit: String(newId) });
                }
              });
            }}
          >
            <p className="text-muted">
              For someone who came in through {team?.name ?? 'the team'}&rsquo;s Discord ticket instead of the form.
            </p>
            <label htmlFor={id} className="field-label">
              Character
            </label>
            <input
              id={id}
              className="input"
              value={name}
              autoComplete="off"
              placeholder="Name-Realm"
              onChange={(e) => setName(e.target.value)}
            />
            {value && !ok && <p className="form-error">Enter the character as Name-Realm.</p>}
            {add.isError && (
              <p className="form-error" role="alert">
                That did not go through: {errorMessage(add.error)}
              </p>
            )}
            <div className="rcs-buttons">
              <button type="button" className="button" disabled={add.isPending} onClick={close}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={!ok || add.isPending}>
                {add.isPending ? 'Adding…' : 'Add recruit'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
