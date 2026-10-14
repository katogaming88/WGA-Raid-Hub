import { useState } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import {
  LOOKUP_LIMIT,
  useLookup,
  useRevokeSiteAdmin,
  useSetMaintenance,
  useSiteAdmins,
  useSiteSwitches,
  type LookupResult,
  type SiteAdminRow,
  type SiteSwitches
} from './useSiteAdmin';
// .button-danger lives with the officer settings pages.
import '../settings/settings.css';
import './siteadmin.css';

// Site admin (#1364): only what belongs to the whole site. Anything a guild
// runs for itself is on that guild's own pages. Remove a guild comes with
// #1515.
export function SiteAdminPage() {
  return (
    <section className="page siteadmin-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Site admin</h1>
      </div>
      <p className="text-muted">For Staff only. Changes here apply to the whole site, every guild included.</p>
      <div className="siteadmin-cards">
        <SiteAdminsCard />
        <SwitchesCard />
        <LookupCard />
      </div>
    </section>
  );
}

function SiteAdminsCard() {
  const admins = useSiteAdmins();
  return (
    <div className="card siteadmin-card">
      <h2>Site admins</h2>
      <DataState query={admins} label="the site admins">
        {(rows) => <SiteAdminsList rows={rows} />}
      </DataState>
    </div>
  );
}

function SiteAdminsList({ rows }: { rows: SiteAdminRow[] }) {
  const { announce } = useStatus();
  const revoke = useRevokeSiteAdmin();
  const [removing, setRemoving] = useState<SiteAdminRow | null>(null);
  const onlyOne = rows.length <= 1;

  const onRemove = () => {
    const row = removing;
    if (!row?.discord_id) return;
    revoke.mutate(
      { discordId: row.discord_id },
      {
        onSuccess: () => {
          setRemoving(null);
          announce('success', 'Site admin removed.');
        },
        onError: (error) => {
          setRemoving(null);
          announce('error', `Could not remove: ${errorMessage(error)}`);
        }
      }
    );
  };

  return (
    <>
      <ul className="siteadmin-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span className="siteadmin-name">{row.display_name || 'Not signed in yet'}</span>
            <span className="text-muted">Discord ID {row.discord_id ?? 'unknown'}</span>
            <button
              type="button"
              className="button"
              disabled={onlyOne || !row.discord_id}
              onClick={() => setRemoving(row)}
              aria-label={`Remove ${row.display_name || row.discord_id || 'this site admin'}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {onlyOne && <p className="text-muted">The last site admin cannot be removed.</p>}

      <p className="text-muted">
        Adding someone to Staff is coming with Staff ranks and a one-time invite link that another Staff member approves
        (#1520).
      </p>

      {removing && (
        <Dialog title="Remove site admin" onClose={() => setRemoving(null)} busy={revoke.isPending}>
          <p>
            Remove {removing.display_name || `Discord ID ${removing.discord_id}`} as a site admin? They keep their guild
            and team ranks.
          </p>
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" onClick={() => setRemoving(null)} disabled={revoke.isPending}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={onRemove} disabled={revoke.isPending}>
              {revoke.isPending ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function SwitchesCard() {
  const switches = useSiteSwitches();
  return (
    <div className="card siteadmin-card">
      <h2>Site switches</h2>
      <DataState query={switches} label="the site switches">
        {(data) => <Switches data={data} />}
      </DataState>
    </div>
  );
}

function Switches({ data }: { data: SiteSwitches }) {
  const { announce } = useStatus();
  const save = useSetMaintenance();
  const [message, setMessage] = useState(data.maintenanceMessage);
  const [confirming, setConfirming] = useState(false);
  const on = data.maintenanceMode;

  const apply = (enabled: boolean) =>
    save.mutate(
      { enabled, message },
      {
        onSuccess: () => {
          setConfirming(false);
          announce('success', enabled ? 'Maintenance mode is on.' : 'Maintenance mode is off.');
        },
        onError: (error) => {
          setConfirming(false);
          announce('error', `Could not change maintenance mode: ${errorMessage(error)}`);
        }
      }
    );

  return (
    <>
      <div className="siteadmin-switch">
        <h3>Maintenance mode</h3>
        <p>
          <span className={on ? 'siteadmin-on' : 'siteadmin-off'}>{on ? 'On' : 'Off'}</span>
          <span className="text-muted">
            {on ? ' Visitors see the maintenance message instead of the site.' : ' The site is open as usual.'}
          </span>
        </p>
        <div className="field">
          <label className="field-label" htmlFor="siteadmin-maintenance">
            Message visitors see
          </label>
          <textarea
            id="siteadmin-maintenance"
            className="input"
            rows={2}
            value={message}
            placeholder="We're making some changes. Back soon."
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div className="siteadmin-row">
          {on ? (
            <>
              <button
                type="button"
                className="button button-primary"
                disabled={save.isPending}
                onClick={() => apply(false)}
              >
                {save.isPending ? 'Working…' : 'Turn off'}
              </button>
              <button type="button" className="button" disabled={save.isPending} onClick={() => apply(true)}>
                Save message
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button-danger"
              disabled={save.isPending}
              onClick={() => setConfirming(true)}
            >
              Turn on
            </button>
          )}
        </div>
      </div>

      <div className="siteadmin-switch">
        <h3>New guilds can sign up</h3>
        <p>
          <span className={data.guildCreationOpen ? 'siteadmin-on' : 'siteadmin-off'}>
            {data.guildCreationOpen ? 'Open' : 'Shut'}
          </span>
          <span className="text-muted"> Stays shut until guild grants are tied to a guild (#1324).</span>
        </p>
      </div>

      {confirming && (
        <Dialog title="Turn on maintenance mode" onClose={() => setConfirming(false)} busy={save.isPending}>
          <p>Every guild's raiders and officers see the maintenance message until it is turned off. Turn it on?</p>
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={save.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => apply(true)}
              disabled={save.isPending}
            >
              {save.isPending ? 'Working…' : 'Turn on'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function LookupCard() {
  const [typed, setTyped] = useState('');
  const [term, setTerm] = useState('');
  const lookup = useLookup(term);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setTerm(typed);
  };

  return (
    <div className="card siteadmin-card">
      <h2>Look someone up</h2>
      <p className="text-muted">
        Find a character, team or guild by name, for when someone asks for help in the support Discord. Read-only.
      </p>
      <form className="siteadmin-row" onSubmit={onSearch} role="search">
        <label className="visually-hidden" htmlFor="siteadmin-lookup">
          Name to look up
        </label>
        <input
          id="siteadmin-lookup"
          className="input siteadmin-lookup"
          type="search"
          value={typed}
          placeholder="Character, team or guild name"
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="button" disabled={typed.trim().length < 2}>
          Look up
        </button>
      </form>
      {term.trim().length >= 2 && (
        <DataState query={lookup} label="the lookup">
          {(result) => <LookupResults result={result} />}
        </DataState>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { team_leader: 'Team leader', officer: 'Officer', raider: 'Raider' };

function LookupResults({ result }: { result: LookupResult }) {
  const { characters, teams, guilds } = result;
  if (!characters.length && !teams.length && !guilds.length) {
    return <p className="text-muted">Nothing matches that name.</p>;
  }
  return (
    <div className="siteadmin-results">
      {characters.length > 0 && (
        <section aria-labelledby="lookup-characters">
          <h3 id="lookup-characters">Characters</h3>
          <ul className="siteadmin-list">
            {characters.map((c) => {
              const team = c.teams;
              const guild = team?.guilds ?? null;
              const member = c.team_members;
              const profile = guild && team && c.url_code ? `/g/${guild.url_key}/t/${team.slug}/p/${c.url_code}` : null;
              return (
                <li key={c.id}>
                  <span className="siteadmin-name">
                    {profile ? <Link to={profile}>{c.name_realm}</Link> : c.name_realm}
                  </span>
                  <span className="text-muted">
                    {[
                      team ? `${team.name}${guild ? ` (${guild.name})` : ''}` : 'No team',
                      member ? (ROLE_LABEL[member.role] ?? member.role) : 'Not claimed',
                      member?.discord_id ? `Discord ID ${member.discord_id}` : null,
                      c.archived_at || member?.archived_at ? 'Left the roster' : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
          {characters.length === LOOKUP_LIMIT && <MoreNote />}
        </section>
      )}
      {teams.length > 0 && (
        <section aria-labelledby="lookup-teams">
          <h3 id="lookup-teams">Teams</h3>
          <ul className="siteadmin-list">
            {teams.map((t) => (
              <li key={t.id}>
                <span className="siteadmin-name">
                  {t.guilds ? <Link to={`/g/${t.guilds.url_key}/t/${t.slug}`}>{t.name}</Link> : t.name}
                </span>
                <span className="text-muted">
                  {[t.guilds?.name ?? 'No guild', t.archived_at ? 'Archived' : null].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {teams.length === LOOKUP_LIMIT && <MoreNote />}
        </section>
      )}
      {guilds.length > 0 && (
        <section aria-labelledby="lookup-guilds">
          <h3 id="lookup-guilds">Guilds</h3>
          <ul className="siteadmin-list">
            {guilds.map((g) => (
              <li key={g.id}>
                <span className="siteadmin-name">
                  <Link to={`/g/${g.url_key}`}>{g.name}</Link>
                </span>
                <span className="text-muted">
                  {[g.realm, g.region?.toUpperCase()].filter(Boolean).join(' · ') || 'No realm recorded'}
                </span>
              </li>
            ))}
          </ul>
          {guilds.length === LOOKUP_LIMIT && <MoreNote />}
        </section>
      )}
    </div>
  );
}

function MoreNote() {
  return <p className="text-muted">Showing the first {LOOKUP_LIMIT}. Type more of the name to narrow it down.</p>;
}
