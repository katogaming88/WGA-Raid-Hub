import { describe, it, expect } from 'vitest';
import { postedOnce } from '../src/postedOnce';

describe('postedOnce', () => {
  it('lets an id through once', () => {
    const first = postedOnce();
    expect(first(41)).toBe(true);
    expect(first(41)).toBe(false);
    expect(first(42)).toBe(true);
  });

  it('forgets the oldest id past its limit', () => {
    const first = postedOnce(2);
    first(1);
    first(2);
    first(3);
    expect(first(1)).toBe(true);
    expect(first(3)).toBe(false);
  });
});
