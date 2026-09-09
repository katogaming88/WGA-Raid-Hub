// Proves the React-swap spike actually renders, not just compiles. Uses
// react-dom/server's renderToStaticMarkup rather than jsdom + a real DOM --
// no new test-environment dependency needed, and it's enough to assert the
// markup/classnames the existing css/styles.css rules depend on are intact.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarGrid from '../../web/calendar/CalendarGrid.jsx';

const dayViewHref = (dateStr) => 'calendar.html?date=' + dateStr;

describe('CalendarGrid (React-swap spike)', () => {
  it('renders a heading outline instead of the vanilla bare <span>', () => {
    const html = renderToStaticMarkup(
      <CalendarGrid
        year={2026}
        month={0}
        nights={[]}
        compact={false}
        teamName="Phoenix"
        teamSlug="phoenix"
        dayViewHref={dayViewHref}
        onNavMonth={() => {}}
      />
    );
    expect(html).toContain('<h2 class="pub-loot-title">Calendar -- Phoenix</h2>');
    expect(html).toMatch(/<h3[^>]*>January 2026<\/h3>/);
  });

  it('marks a raid day present by default, with the roster count', () => {
    const html = renderToStaticMarkup(
      <CalendarGrid
        year={2026}
        month={0}
        nights={[
          { date: '2026-01-05', startTime: '20:00', durationMinutes: 180, isOptional: false, isException: false }
        ]}
        rosterCount={20}
        benchCount={4}
        compact={false}
        teamName="Phoenix"
        teamSlug="phoenix"
        dayViewHref={dayViewHref}
        onNavMonth={() => {}}
      />
    );
    expect(html).toContain('href="calendar.html?date=2026-01-05"');
    expect(html).toContain('mini-cal-day-raid');
    expect(html).toContain('calendar-status-present');
    expect(html).toContain('16/20');
    expect(html).toContain('4 on Bench (excluded from the count above)');
  });

  it('marks an optional-night raid day tentative when the raider has no override', () => {
    const html = renderToStaticMarkup(
      <CalendarGrid
        year={2026}
        month={0}
        nights={[
          { date: '2026-01-12', startTime: '20:00', durationMinutes: 180, isOptional: true, isException: false }
        ]}
        rosterCount={20}
        dayViewHref={dayViewHref}
        onNavMonth={() => {}}
      />
    );
    expect(html).toContain('calendar-status-tentative');
    expect(html).toContain('No Response');
  });

  it("colors a raid day by the raider's own override, not the computed default", () => {
    const html = renderToStaticMarkup(
      <CalendarGrid
        year={2026}
        month={0}
        nights={[
          { date: '2026-01-05', startTime: '20:00', durationMinutes: 180, isOptional: false, isException: false }
        ]}
        myOverridesByDate={{ '2026-01-05': { status: 'Absent' } }}
        rosterCount={20}
        dayViewHref={dayViewHref}
        onNavMonth={() => {}}
      />
    );
    expect(html).toContain('calendar-status-absent');
    expect(html).toContain('aria-label="Absent"');
  });

  it('renders the compact widget without nav buttons, with a link to the full calendar', () => {
    const html = renderToStaticMarkup(
      <CalendarGrid
        year={2026}
        month={0}
        nights={[]}
        compact
        teamSlug="wrathless"
        dayViewHref={dayViewHref}
        onNavMonth={() => {}}
      />
    );
    expect(html).not.toContain('mini-cal-nav-btn');
    expect(html).toContain('href="calendar.html?team=wrathless"');
    expect(html).toContain('View full calendar');
  });

  it('omits the compact-only "View full calendar" link in full mode', () => {
    const html = renderToStaticMarkup(
      <CalendarGrid
        year={2026}
        month={0}
        nights={[]}
        compact={false}
        teamName="Phoenix"
        dayViewHref={dayViewHref}
        onNavMonth={() => {}}
      />
    );
    expect(html).not.toContain('View full calendar');
    expect(html).toContain('mini-cal-nav-btn');
  });
});
