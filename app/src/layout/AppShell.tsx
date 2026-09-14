import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatches, useParams } from 'react-router';
import { FlameMark, Icon } from '../components/Icon';
import { useTheme } from '../theme/theme';
import { defaultTeamKey } from '../config';
import { navGroups } from './nav';
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

  const team = teamKey ?? defaultTeamKey();
  const matches = useMatches();
  const pageTitle = (matches.at(-1)?.handle as RouteHandle | undefined)?.title ?? '';
  const groups = navGroups({ team: `/g/${guildKey}/t/${team}`, guild: `/g/${guildKey}` });

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
            <span className="brand-guild">{guildKey}</span>
          </span>
          <button type="button" className="drawer-close icon-button" aria-label="Close menu" onClick={closeDrawer}>
            <Icon name="close" />
          </button>
        </div>

        <div className="team-switcher">
          <span className="team-dot" aria-hidden="true" />
          <span className="team-name">{team}</span>
        </div>

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

        <div className="signed-in">
          <span className="avatar" aria-hidden="true" />
          <span className="text-muted">Not signed in</span>
        </div>
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
              <li className="breadcrumb-team">{teamKey ?? guildKey}</li>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
