import { Link, Navigate, useLocation } from 'react-router';
import { usePageCan } from '../auth/access';
import { useAddress } from '../data/address';
import { GUILD_SETTINGS_TABS } from '../layout/nav';
import { MembersPanel } from './MembersPanel';
import { RankPermissionsPanel } from './RankPermissionsPanel';
import { TeamsPanel } from './TeamsPanel';
import './guildsettings.css';

// Guild settings (#1644): what a guild officer sets for the guild as a whole,
// one tab per area: Teams, Members (#1650) and the rank permissions grid
// (#1652). Each tab has its own address.
export function GuildSettingsPage() {
  const { guild } = useAddress();
  const { pathname } = useLocation();
  const { can } = usePageCan();
  return (
    <section className="page guildsettings-page" aria-labelledby="page-title">
      <nav className="report-tabs" aria-label="Guild settings">
        {GUILD_SETTINGS_TABS.filter((tab) => can(tab.ability)).map((tab) => {
          const to = `/g/${guild.key}/${tab.to}`;
          return (
            <Link key={tab.to} to={to} aria-current={pathname === to ? 'page' : undefined}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {pathname.endsWith('/members') ? (
        <MembersPanel />
      ) : pathname.endsWith('/rank-permissions') ? (
        <RankPermissionsPanel />
      ) : (
        <TeamsPanel />
      )}
    </section>
  );
}

// /settings opens the first tab the person can use. With none, the Teams tab
// says who the page is for.
export function GuildSettingsIndex() {
  const { can, loading } = usePageCan();
  if (loading) return null;
  const tab = GUILD_SETTINGS_TABS.find((t) => can(t.ability)) ?? GUILD_SETTINGS_TABS[0]!;
  return <Navigate to={`../${tab.to}`} replace />;
}
