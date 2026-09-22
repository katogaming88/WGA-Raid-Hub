import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { SUPPORT_DISCORD_URL } from '../config';

describe('About', () => {
  it('has both cards, and links the support Discord', async () => {
    renderApp('/g/wga/about');
    await screen.findByRole('heading', { level: 1, name: 'About' });
    expect(screen.getByRole('heading', { level: 2, name: 'What is this?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'About Kat' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /support Discord/ });
    expect(link).toHaveAttribute('href', SUPPORT_DISCORD_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });
});
