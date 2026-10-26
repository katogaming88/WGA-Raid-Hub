import { Link, useLocation } from 'react-router';
import { useAddress } from '../data/address';
import { GUILD_SETTINGS_TABS } from '../layout/nav';
import { TeamsPanel } from './TeamsPanel';
import './guildsettings.css';

// Guild settings (#1644): what a guild officer sets for the guild as a whole,
// one tab per area. Teams is the first; the Members tab (#1650) and the rank
// permissions grid (#1652) join it. Each tab has its own address.
export function GuildSettingsPage() {
  const { guild } = useAddress();
  const { pathname } = useLocation();
  return (
    <section className="page guildsettings-page" aria-labelledby="page-title">
      <nav className="report-tabs" aria-label="Guild settings">
        {GUILD_SETTINGS_TABS.map((tab) => {
          const to = `/g/${guild.key}/${tab.to}`;
          return (
            <Link key={tab.to} to={to} aria-current={pathname === to ? 'page' : undefined}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <TeamsPanel />
    </section>
  );
}
