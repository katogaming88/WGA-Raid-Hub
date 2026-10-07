import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { setErrorReporter } from '../lib/errors';
import { wayOn } from './NotFoundPage';

// A page that crashes, standing in for any real one (#1477).
vi.mock('../about/AboutPage', () => ({
  AboutPage: () => {
    throw new Error('boom: secret detail');
  }
}));
vi.mock('../front/FrontPage', () => ({
  FrontPage: () => {
    throw new Error('front boom');
  }
}));

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

// React logs a caught render error; keep the test output clean.
const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('crash screen', () => {
  it('shows inside the frame, reports the error, and never shows its details', async () => {
    quietConsole();
    const reported: unknown[] = [];
    setErrorReporter((error, context) => reported.push([context.where, (error as Error).message]));
    renderApp('/g/wga/about');

    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong on this page' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the guild page' })).toHaveAttribute('href', '/g/wga');
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument();
    expect(reported).toContainEqual(['page crash', 'boom: secret detail']);
  });

  it('shows on its own for a page outside the frame', async () => {
    quietConsole();
    setErrorReporter(() => {});
    renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong on this page' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  });
});

describe('page not found', () => {
  it("offers the team's home for a wrong team page, and reports nothing", async () => {
    const reported: unknown[] = [];
    // The frame's own reads (news.json has no server here) may report; the 404 must not.
    setErrorReporter((_error, context) => reported.push(context.where));
    renderApp('/g/wga/t/phoenix/nope');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: "Go to the team's home" })).toHaveAttribute('href', '/g/wga/t/phoenix');
    expect(reported).not.toContain('page crash');
  });

  it('offers the guild page for a wrong guild page', async () => {
    renderApp('/g/wga/nope');
    expect(await screen.findByRole('link', { name: 'Go to the guild page' })).toHaveAttribute('href', '/g/wga');
  });

  it('offers the site home for an address outside the app', async () => {
    renderApp('/something-else');
    expect(await screen.findByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  });

  it('offers the site home when the team in the address does not exist, not a link back to it', async () => {
    renderApp('/g/wga/t/nope');
    expect(await screen.findByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  });

  it('picks the most useful way on from the address', () => {
    expect(wayOn('wga', 'phoenix').to).toBe('/g/wga/t/phoenix');
    expect(wayOn('wga').to).toBe('/g/wga');
    expect(wayOn().to).toBe('/');
  });
});
