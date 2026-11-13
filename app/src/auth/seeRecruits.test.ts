import { describe, expect, it } from 'vitest';
import { NO_ACCESS, can, type Permissions } from './access';

// The Recruits page (#1549) opens for Edit recruiting or any guild rank; the
// database still decides per team.
const perms = (team: string[], guild: string[]): Permissions => ({ team: new Set(team), guild: new Set(guild) });

describe('seeRecruits', () => {
  it('opens for Edit recruiting, a guild rank, and a site admin', () => {
    expect(can(NO_ACCESS, 'seeRecruits', perms(['edit_recruiting'], []))).toBe(true);
    expect(can(NO_ACCESS, 'seeRecruits', perms([], ['view_every_team']))).toBe(true);
    expect(can({ ...NO_ACCESS, siteAdmin: true }, 'seeRecruits', perms([], []))).toBe(true);
  });

  it('stays closed for a raider and for someone with other officer tools only', () => {
    expect(can(NO_ACCESS, 'seeRecruits', perms([], []))).toBe(false);
    expect(can(NO_ACCESS, 'seeRecruits', perms(['edit_roster'], []))).toBe(false);
  });
});
