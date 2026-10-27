import { describe, it, expect } from 'vitest';
import { postedOnce } from '../src/postedOnce';

describe('postedOnce', () => {
  it('lets an id through once', () => {
    const { claim } = postedOnce();
    expect(claim(41)).toBe(true);
    expect(claim(41)).toBe(false);
    expect(claim(42)).toBe(true);
  });

  it('lets a released id through again', () => {
    const { claim, release } = postedOnce();
    claim(41);
    release(41);
    expect(claim(41)).toBe(true);
  });

  it('forgets the oldest id past its limit', () => {
    const { claim } = postedOnce(2);
    claim(1);
    claim(2);
    claim(3);
    expect(claim(1)).toBe(true);
    expect(claim(3)).toBe(false);
  });
});
