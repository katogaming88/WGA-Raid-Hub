import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

describe('routing', () => {
  it('sends / to the default team home', async () => {
    const { router } = renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/g/wga/t/phoenix');
  });

  it('marks the current page in the sidebar and the breadcrumb', async () => {
    renderAt('/g/wga/t/phoenix');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    await userEvent.click(screen.getByRole('link', { name: 'Roster' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Roster' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Roster' })).toHaveAttribute('aria-current', 'page');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Roster')).toBeInTheDocument();
  });

  it('routes officer tools under /officer/ and guild pages without a team', async () => {
    renderAt('/g/wga/t/phoenix/officer/priority');
    expect(await screen.findByRole('heading', { level: 1, name: 'Loot priority' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'BoE sales' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'BoE sales' })).toBeInTheDocument();
  });

  it('shows page not found inside the frame for an unknown team page', async () => {
    renderAt('/g/wga/t/phoenix/nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('shows page not found for an address outside the app', async () => {
    renderAt('/something-else');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it.each(['/g/wga/t/phoenix', '/g/wga/t/phoenix/me', '/g/wga/news', '/g/wga/t/phoenix/nope'])(
    'has exactly one h1 at %s',
    async (path) => {
      renderAt(path);
      await screen.findAllByRole('heading', { level: 1 });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    }
  );
});

describe('page structure', () => {
  it('has a skip link to the main content', async () => {
    renderAt('/g/wga/t/phoenix');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});

describe('theme', () => {
  it('switches to light mode, remembers it, and reports the pressed state', async () => {
    renderAt('/g/wga/t/phoenix');
    await screen.findByRole('heading', { level: 1 });
    const light = screen.getByRole('button', { name: 'Light mode' });
    expect(light).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(light);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('wga-theme')).toBe('light');
    expect(light).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts from a saved choice', async () => {
    localStorage.setItem('wga-theme', 'light');
    renderAt('/g/wga/t/phoenix');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('narrow-screen drawer', () => {
  it('opens from the menu button, moves focus in, and Escape closes it and returns focus', async () => {
    renderAt('/g/wga/t/phoenix');
    await screen.findByRole('heading', { level: 1 });
    const menu = screen.getByRole('button', { name: 'Open menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', 'sidebar');

    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('sidebar')).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });

  it('closes when a link is followed', async () => {
    renderAt('/g/wga/t/phoenix');
    await screen.findByRole('heading', { level: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'Calendar' }));
    await screen.findByRole('heading', { level: 1, name: 'Calendar' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
  });
});
