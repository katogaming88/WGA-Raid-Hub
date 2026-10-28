import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLootCouncil } from '../settings/useSettings';
import { flushSync } from 'react-dom';
import { Link, Navigate, NavLink, Outlet, useLocation, useMatches, useParams } from 'react-router';
import { Icon, LogoMark } from '../components/Icon';
import { DataState } from '../components/DataState';
import { useTheme } from '../theme/theme';
import { defaultTeamKey, previewTeamKeys, SUPPORT_DISCORD_URL } from '../config';
import {
  AddressProvider,
  canonicalPath,
  useGuild,
  useGuildTeams,
  useResolvedAddress,
  type Address
} from '../data/address';
import { NotFoundPage, NotInTestPage, wayOn } from '../pages/NotFoundPage';
import { AccountPanel } from '../auth/AccountPanel';
import { ConnectPrompt } from '../auth/ConnectPrompt';
import { AltsPickerProvider } from '../characters/AltsPicker';
import { useAccess, useCan, usePreviewTeams } from '../auth/access';
import { useSession } from '../auth/session';
import { navGroups, pageHolds, type NavGroup, type NavItem } from './nav';
import { defaultGuildKey, forgetGuild, lastGuildKey, rememberGuild } from './lastGuild';
import { TeamSwitcher } from './TeamSwitcher';
import { StreamWidget } from '../streams/StreamWidget';
import { hasUnread } from '../news/news';
import { liveCount } from '../streams/directory';
import { useGuildStreamers } from '../streams/StreamWidget';
import { useNews, useNewsSeen } from '../news/useNews';
import type { RouteHandle } from '../routes';
import './layout.css';

export function AppShell() {
  const params = useParams();
  const { teamKey } = params;
  // A site page (/news) has no guild in its address: its frame is the guild
  // this browser was last on (#1482). A remembered guild that no longer
  // resolves falls back to the default one.
  const sitePage = params.guildKey === undefined;
  const [siteGuild, setSiteGuild] = useState(lastGuildKey);
  const guildKey = params.guildKey ?? siteGuild;
  useEffect(() => {
    if (params.guildKey) rememberGuild(params.guildKey);
  }, [params.guildKey]);
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(location.pathname);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  const resolvedQuery = useResolvedAddress(guildKey, teamKey);
  const resolved = resolvedQuery.data ?? null;
  // A new address is looked up again, so remember the guild meanwhile: without
  // it the sidebar lost its Officer group for a moment on every page change
  // (#1228).
  const [knownGuild, setKnownGuild] = useState<{ key: string; id: number } | null>(null);
  if (resolved && (knownGuild?.key !== guildKey || knownGuild.id !== resolved.guildId)) {
    setKnownGuild({ key: guildKey, id: resolved.guildId });
  }
  const guildId = resolved?.guildId ?? (knownGuild?.key === guildKey ? knownGuild.id : undefined);
  const guildQuery = useGuild(guildId);
  const teamsQuery = useGuildTeams(guildId);

  const { user } = useSession();
  const access = useAccess();
  // On the preview, everyone but a site admin sees only the test team (#1676).
  const preview = usePreviewTeams();
  const limited = preview !== null;
  // An unlisted team (#1644) is left out for anyone not on it, guild officers
  // included, but still opens by its address, so the team being viewed stays.
  const onTeamIds = new Set((access.data?.teams ?? []).map((t) => t.teamId));
  const teams = (teamsQuery.data ?? [])
    .filter((t) => !t.unlisted || onTeamIds.has(t.id) || t.id === resolved?.teamId)
    .filter((t) => !limited || preview?.has(t.slug))
    .map((t) => ({
      id: t.id,
      key: t.slug,
      name: t.name,
      archived: t.archived_at !== null
    }));
  const currentTeam = resolved?.teamId ? teams.find((t) => t.id === resolved.teamId) : undefined;

  const matches = useMatches();
  const pageTitle = (matches.at(-1)?.handle as RouteHandle | undefined)?.title ?? '';
  const news = useNews();
  const [newsSeen] = useNewsSeen();
  // Read from the build setting, so the links are right while access loads.
  const testKey = limited ? previewTeamKeys()?.[0] : undefined;
  const navTeamKey = teamKey ?? testKey ?? defaultTeamKey();
  // A guild page has no team of its own, so its team links and Officer group
  // follow the team those links go to.
  const navTeam = currentTeam ?? teams.find((t) => t.key === navTeamKey);
  // The same cached read as the Streams page and the floating panel.
  const teamIds = teams.map((t) => t.id);
  const streamers = useGuildStreamers(teamIds);
  // Where the sidebar's links point; a Help guide's "Take me there" reads it
  // from the outlet.
  const base = { team: `/g/${guildKey}/t/${navTeamKey}`, guild: `/g/${guildKey}` };
  const council = useLootCouncil(navTeam?.id ?? 0);
  const permissions = useCan(navTeam?.id, guildId);
  const { can } = permissions;
  const groups = navGroups(base, {
    can,
    guildSettings: can('manageTeams') && !limited,
    hideBoe: limited,
    siteAdmin: can('adminSite'),
    newsUnread: news.isSuccess && hasUnread(news.data, newsSeen),
    liveCount: streamers.isSuccess ? liveCount(streamers.data) : 0,
    council
  });

  // Officer menu: one group open at a time. On a page change the group holding
  // the new page opens itself (#869), and a group left open by hand closes when
  // the new page is outside it (Kat, 2026-10-15).
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState('');
  const holder = groups.flatMap((g) => g.items).find((i) => i.pages?.some((p) => pageHolds(p, location.pathname)));
  // The Officer group appears once access loads, so wait for a holder before
  // marking this page as handled.
  if (holder && menuAt !== location.pathname) {
    setMenuAt(location.pathname);
    setOpenMenu(holder.label);
  }
  // Leaving for a page outside every group closes whatever was open.
  const [leftFrom, setLeftFrom] = useState(location.pathname);
  if (leftFrom !== location.pathname) {
    setLeftFrom(location.pathname);
    if (!holder) setOpenMenu(null);
  }

  // The sidebar never shows a scrollbar (Kat, 2026-10-18), folding sections
  // only as far as it must, one at a time from the top (Kat, 2026-10-19):
  // level N folds the top N sections, never the open one. Site is at the
  // bottom, so it stays open whenever it can.
  // Going up a level, the overflow is measured exactly and kept for this page
  // and open group. Coming back down, the kept height (or an estimate before
  // there is one) decides. An estimate that is short steps down once,
  // overflows, and keeps the real height, so folding never loops.
  const [level, setLevel] = useState(0);
  const headings = groups.map((g) => g.heading);
  const headingsKey = headings.join('|');
  const kept = useRef<{ key: string; heights: number[] }>({ key: '', heights: [] });
  const layoutKey = `${location.pathname}|${openMenu}|${groups.length}`;
  const here = sectionOf(groups, location.pathname);
  const [openSection, setOpenSection] = useState<string | null>(here ?? 'Team');
  const [sectionAt, setSectionAt] = useState('');
  if (here && sectionAt !== location.pathname) {
    setSectionAt(location.pathname);
    setOpenSection(here);
  }
  useLayoutEffect(() => {
    const el = sidebar.current;
    if (!el) return;
    const key = `${layoutKey}|${openSection}`;
    if (kept.current.key !== key) kept.current = { key, heights: [] };
    const order = headingsKey.split('|');
    const check = () => {
      const foldable = order.filter((h) => h !== openSection).length;
      if (el.scrollHeight > el.clientHeight && level < foldable) {
        kept.current.heights[level] = el.scrollHeight;
        setLevel(level + 1);
        return;
      }
      if (level === 0) return;
      const below = level - 1;
      const height = kept.current.heights[below] ?? estimatedHeight(el, (h) => !folded(below, h, openSection, order));
      if (height <= el.clientHeight) setLevel(below);
    };
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    return () => watch.disconnect();
  }, [level, layoutKey, openSection, headingsKey]);

  // Following a link closes the drawer.
  if (drawerOpen && location.pathname !== openedAt) {
    setDrawerOpen(false);
  }

  const openDrawer = () => {
    setOpenedAt(location.pathname);
    setDrawerOpen(true);
  };
  // The menu button sits in the main column, which is inert while the drawer is
  // open, and a browser ignores focus() on an inert element. So the close is
  // rendered first (flushSync), and only then does focus go back. jsdom does not
  // enforce inert; the browser test in tests/browser-app/ caught this.
  const closeDrawer = () => {
    flushSync(() => setDrawerOpen(false));
    menuButton.current?.focus();
  };

  // While open on a narrow screen the drawer behaves like a dialog: focus moves
  // in, the page behind it is inert, Escape closes it, and focus returns to the
  // menu button (#1101 accessibility checklist).
  useEffect(() => {
    if (!drawerOpen) return;
    sidebar.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
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
  } else if (!resolved && sitePage && guildKey !== defaultGuildKey()) {
    forgetGuild();
    setSiteGuild(defaultGuildKey());
    content = null;
  } else if (!resolved) {
    // The guild or team key does not exist, so a link back to it would land
    // here again.
    content = <NotFoundPage home={wayOn()} />;
  } else if (!sitePage && !resolved.isCanonical) {
    // A site page's address names no guild, so only guild addresses are put right.
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
  } else if (preview === undefined || (!sitePage && user && (!access.isSuccess || permissions.loading))) {
    content = (
      <DataState query={permissions.query} label="your access">
        {() => null}
      </DataState>
    );
  } else if (!sitePage && !can('viewEveryTeam') && !teamsQuery.data.some((t) => onTeamIds.has(t.id))) {
    // A guild's pages are for its members (#1264): anyone without a current
    // membership on one of its teams, signed out included, gets the front
    // page, and so does Staff. Someone whose rank in this guild sees every
    // team (an Owner or Admin by default, #1649) gets in without a team.
    // The database still lets them read until cutover (#1699).
    content = <Navigate to="/" replace />;
  } else if (
    limited &&
    (resolved.teamKey
      ? !preview.has(resolved.teamKey.toLowerCase())
      : !sitePage && /^\/g\/[^/]+\/(boe|settings)(\/|$)/.test(location.pathname))
  ) {
    const testTeam = teamsQuery.data.find((t) => t.slug === testKey);
    content = (
      <NotInTestPage testTeam={{ to: `/g/${guildKey}/t/${testKey ?? ''}`, label: testTeam?.name ?? testKey ?? '' }} />
    );
  } else {
    const address: Address = {
      guild: { id: guildQuery.data.id, key: guildQuery.data.url_key, name: guildQuery.data.name },
      team: currentTeam ? { id: currentTeam.id, key: currentTeam.key, name: currentTeam.name } : null,
      teams
    };
    content = (
      <AddressProvider value={address}>
        <AltsPickerProvider>
          <ConnectPrompt />
          <Outlet context={base} />
          {currentTeam && <StreamWidget teamId={currentTeam.id} teamIds={teamIds} />}
        </AltsPickerProvider>
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
          {/* The title opens the site front page; there is no sidebar item for
              it (Kat, 2026-10-15, #1226). */}
          <Link to="/" className="brand-link" aria-current={location.pathname === '/' ? 'page' : undefined}>
            <span className="brand-mark">
              <LogoMark />
            </span>
            <span className="brand-text">
              <span className="brand-name">WGA Raid Hub</span>
              <span className="brand-guild">{guildQuery.data?.name ?? guildKey}</span>
            </span>
          </Link>
          <button type="button" className="drawer-close icon-button" aria-label="Close menu" onClick={closeDrawer}>
            <Icon name="close" />
          </button>
        </div>

        <TeamSwitcher
          guildKey={guildKey}
          guildId={guildId}
          canAddTeam={can('manageTeams') && !limited}
          teams={teams}
          currentKey={currentTeam?.key ?? null}
          label={currentTeam?.name ?? 'Choose a team'}
        />

        <nav aria-label="Main">
          {groups.map((group) => (
            <div key={group.heading} className="nav-group">
              <h2 className="nav-heading">
                {folded(level, group.heading, openSection, headings) ||
                (group.heading === openSection && folded(level, group.heading, null, headings)) ? (
                  <button
                    type="button"
                    className="nav-section-toggle"
                    aria-expanded={openSection === group.heading}
                    aria-controls={`section-${group.heading}`}
                    onClick={() => setOpenSection(openSection === group.heading ? null : group.heading)}
                  >
                    {group.heading}
                    <Icon name="chevronRight" size={12} />
                  </button>
                ) : (
                  <span className="nav-section-label">{group.heading}</span>
                )}
              </h2>
              <ul id={`section-${group.heading}`} hidden={folded(level, group.heading, openSection, headings)}>
                {group.items.map((item) =>
                  item.pages ? (
                    <NavDisclosure
                      key={item.label}
                      item={item}
                      open={openMenu === item.label}
                      onToggle={() => {
                        setOpenMenu(openMenu === item.label ? null : item.label);
                        setOpenSection(group.heading);
                      }}
                    />
                  ) : (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end ?? false}
                        className="nav-item"
                        aria-label={
                          item.mark ? `${item.label}, new` : item.live ? `${item.label}, ${item.live} live` : undefined
                        }
                      >
                        <Icon name={item.icon} />
                        <span>{item.label}</span>
                        {item.mark && <span className="nav-mark" aria-hidden="true" />}
                        {/* The space keeps "Streams" and the count apart for
                            voice control: the label has to contain them in order. */}
                        {!!item.live && (
                          <>
                            {' '}
                            <span className="count-badge" aria-hidden="true">
                              {item.live}
                            </span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </nav>

        <AccountPanel teamId={currentTeam?.id ?? null} guildId={guildId ?? null} />

        {/* Help moved into the sidebar's Site group (#1102); this is the one
            link that stays outside the page list. */}
        <div className="sidebar-links">
          <a href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
            Support Discord<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
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

// Whether a section's links are folded away at a fold level: it is one of the
// top `level` sections, counting past the open one. A folded section's
// heading is a button that opens it, and so is the open section's when it
// would fold if closed.
function folded(level: number, heading: string, open: string | null, headings: string[]): boolean {
  if (heading === open) return false;
  return headings.filter((h) => h !== open).indexOf(heading) < level;
}

// The sidebar's height at a lower fold level, estimated: its height now, plus
// a row for each link a section folded now would show (a closed officer
// group's pages stay hidden either way).
function estimatedHeight(el: HTMLElement, shownBelow: (heading: string) => boolean): number {
  const row = el.querySelector<HTMLElement>('nav .nav-item')?.offsetHeight ?? 0;
  let hidden = 0;
  for (const ul of el.querySelectorAll<HTMLElement>('nav [id^="section-"][hidden]')) {
    if (!shownBelow(ul.id.slice('section-'.length))) continue;
    hidden += ul.querySelectorAll('.nav-item').length - ul.querySelectorAll('.nav-sub[hidden] .nav-item').length;
  }
  return el.scrollHeight + hidden * row;
}

// The sidebar section holding a page: an item's address or one below it (an
// `end` item only its own), or one of a group's pages or their tabs.
function sectionOf(groups: NavGroup[], pathname: string): string | null {
  const holds = (i: NavItem) =>
    i.pages
      ? i.pages.some((p) => pageHolds(p, pathname))
      : pathname === i.to || (!i.end && pathname.startsWith(`${i.to}/`));
  return groups.find((g) => g.items.some(holds))?.heading ?? null;
}

function NavDisclosure({ item, open, onToggle }: { item: NavItem; open: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  const panel = `menu-${item.label}`;
  return (
    <li>
      <button
        type="button"
        className="nav-item nav-toggle"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
      >
        <Icon name={item.icon} />
        <span>{item.label}</span>
        <Icon name="chevronRight" size={14} />
      </button>
      <ul id={panel} className="nav-sub" hidden={!open}>
        {item.pages?.map((page) => (
          <li key={page.to}>
            <Link
              to={page.to}
              className={page.danger ? 'nav-item nav-danger' : 'nav-item'}
              aria-current={pageHolds(page, pathname) ? 'page' : undefined}
            >
              <span>{page.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
