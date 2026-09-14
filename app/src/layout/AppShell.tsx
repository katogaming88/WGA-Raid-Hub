import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useMatches, useParams } from 'react-router';
import { FlameMark, Icon } from '../components/Icon';
import { DataState } from '../components/DataState';
import { useTheme } from '../theme/theme';
import { defaultTeamKey } from '../config';
import {
  AddressProvider,
  canonicalPath,
  useGuild,
  useGuildTeams,
  useResolvedAddress,
  type Address
} from '../data/address';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AccountPanel } from '../auth/AccountPanel';
import { ConnectPrompt } from '../auth/ConnectPrompt';
import { can, useAccess } from '../auth/access';
import { navGroups } from './nav';
import { TeamSwitcher } from './TeamSwitcher';
import type { RouteHandle } from '../routes';
import './layout.css';

export function AppShell() {
  const { guildKey = '', teamKey } = useParams();
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(location.pathname);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  const resolvedQuery = useResolvedAddress(guildKey, teamKey);
  const resolved = resolvedQuery.data ?? null;
  const guildQuery = useGuild(resolved?.guildId);
  const teamsQuery = useGuildTeams(resolved?.guildId);

  const teams = (teamsQuery.data ?? []).map((t) => ({
    id: t.id,
    key: t.slug,
    name: t.name,
    archived: t.archived_at !== null
  }));
  const currentTeam = resolved?.teamId ? teams.find((t) => t.id === resolved.teamId) : undefined;

  const matches = useMatches();
  const pageTitle = (matches.at(-1)?.handle as RouteHandle | undefined)?.title ?? '';
  const access = useAccess();
  const navTeamKey = teamKey ?? defaultTeamKey();
  const groups = navGroups(
    { team: `/g/${guildKey}/t/${navTeamKey}`, guild: `/g/${guildKey}` },
    { officer: can(access.data, 'viewOfficerTools', currentTeam?.id) }
  );

  // Following a link closes the drawer.
  if (drawerOpen && location.pathname !== openedAt) {
    setDrawerOpen(false);
  }

  const openDrawer = () => {
    setOpenedAt(location.pathname);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  };

  // While open on a narrow screen the drawer behaves like a dialog: focus moves
  // in, the page behind it is inert, Escape closes it, and focus returns to the
  // menu button (#1101 accessibility checklist).
  useEffect(() => {
    if (!drawerOpen) return;
    sidebar.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // What the main area shows, in order: the address lookup, then page not
  // found or a redirect to the current keys, then the guild and its teams,
  // then the page itself. A failure at any step shows its error box.
  let content;
  if (resolvedQuery.isError || resolvedQuery.isPending) {
    content = (
      <DataState query={resolvedQuery} label="this page">
        {() => null}
      </DataState>
    );
  } else if (!resolved) {
    content = <NotFoundPage />;
  } else if (!resolved.isCanonical) {
    content = <Navigate to={canonicalPath(location.pathname, resolved) + location.search} replace />;
  } else if (guildQuery.isError || guildQuery.isPending) {
    content = (
      <DataState query={guildQuery} label="this guild">
        {() => null}
      </DataState>
    );
  } else if (teamsQuery.isError || teamsQuery.isPending) {
    content = (
      <DataState query={teamsQuery} label="this guild's teams">
        {() => null}
      </DataState>
    );
  } else {
    const address: Address = {
      guild: { id: guildQuery.data.id, key: guildQuery.data.url_key, name: guildQuery.data.name },
      team: currentTeam ? { id: currentTeam.id, key: currentTeam.key, name: currentTeam.name } : null,
      teams
    };
    content = (
      <AddressProvider value={address}>
        <ConnectPrompt />
        <Outlet />
      </AddressProvider>
    );
  }

  return (
    <div className="shell" data-drawer={drawerOpen ? 'open' : 'closed'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside id="sidebar" className="sidebar" ref={sidebar} aria-label="Site">
        <div className="brand">
          <span className="brand-mark">
            <FlameMark />
          </span>
          <span className="brand-text">
            <span className="brand-name">WGA Raid Hub</span>
            <span className="brand-guild">{guildQuery.data?.name ?? guildKey}</span>
          </span>
          <button type="button" className="drawer-close icon-button" aria-label="Close menu" onClick={closeDrawer}>
            <Icon name="close" />
          </button>
        </div>

        <TeamSwitcher
          guildKey={guildKey}
          teams={teams}
          currentKey={currentTeam?.key ?? null}
          label={currentTeam?.name ?? 'Choose a team'}
        />

        <nav aria-label="Main">
          {groups.map((group) => (
            <div key={group.heading} className="nav-group">
              <h2 className="nav-heading">{group.heading}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end className="nav-item">
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <AccountPanel teamId={currentTeam?.id ?? null} />
      </aside>

      {drawerOpen && <div className="drawer-backdrop" aria-hidden="true" onClick={closeDrawer} />}

      <div className="main-column" inert={drawerOpen}>
        <header className="topbar">
          <button
            ref={menuButton}
            type="button"
            className="menu-button icon-button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="sidebar"
            onClick={openDrawer}
          >
            <Icon name="menu" />
          </button>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>{currentTeam?.name ?? guildQuery.data?.name ?? guildKey}</li>
              <li aria-current="page">
                <Icon name="chevronRight" size={14} />
                {pageTitle}
              </li>
            </ol>
          </nav>
          <div className="topbar-spacer" />
          <div className="theme-toggle" role="group" aria-label="Color theme">
            <button
              type="button"
              className="icon-button"
              aria-label="Light mode"
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              <Icon name="sun" size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Dark mode"
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              <Icon name="moon" size={15} />
            </button>
          </div>
        </header>

        <main id="main" className="content" tabIndex={-1}>
          {content}
        </main>
      </div>
    </div>
  );
}
