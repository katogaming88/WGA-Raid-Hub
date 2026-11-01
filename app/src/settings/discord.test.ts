import { describe, expect, it } from 'vitest';
import {
  channelProblem,
  daysLabel,
  postSummary,
  roleProblem,
  sheetTiming,
  takenDays,
  type DiscordServer,
  type SignupSheet
} from './discord';

const SERVER: DiscordServer = {
  id: '100000000000000001',
  name: 'We Go Again',
  botIn: true,
  channels: [
    { id: 'off', name: 'phoenix-officers', category: 'OFFICERS', missing: [] },
    { id: 'att', name: 'phoenix-attendance', category: 'OFFICERS', missing: ['View Channel', 'Send Messages'] }
  ],
  roles: [{ id: 'po', name: 'Phoenix Officer' }]
};

describe('Settings › Discord rows (#994)', () => {
  it('says where a post goes and whom it pings, or Off', () => {
    expect(postSummary(SERVER, { channel_id: 'off', ping_role_id: 'po' })).toEqual({
      text: '#phoenix-officers, pings @Phoenix Officer',
      problem: false
    });
    expect(postSummary(SERVER, { channel_id: 'off', ping_role_id: null }).text).toBe('#phoenix-officers');
    expect(postSummary(SERVER, { channel_id: null, ping_role_id: null })).toEqual({ text: 'Off', problem: false });
  });

  it('flags a channel the bot cannot post in, a deleted channel and a deleted role', () => {
    expect(postSummary(SERVER, { channel_id: 'att', ping_role_id: null })).toEqual({
      text: "The bot can't post in #phoenix-attendance",
      problem: true
    });
    expect(postSummary(SERVER, { channel_id: 'gone', ping_role_id: null }).problem).toBe(true);
    expect(postSummary(SERVER, { channel_id: 'off', ping_role_id: 'gone' })).toEqual({
      text: '#phoenix-officers, its ping role no longer exists',
      problem: true
    });
  });

  it('names the missing permissions in what to fix', () => {
    expect(channelProblem(SERVER, 'att')).toBe(
      "The bot can't post here. In Discord, choose Edit Channel, then Permissions, and add the WGA Raid Hub role with View Channel and Send Messages on."
    );
    expect(channelProblem(SERVER, 'off')).toBeNull();
    expect(channelProblem(SERVER, 'gone')).toMatch(/no longer exists/);
    expect(roleProblem(SERVER, 'po')).toBeNull();
    expect(roleProblem(SERVER, 'gone')).toMatch(/no longer exists/);
  });
});

describe('signup sheets', () => {
  it('lists days Monday first', () => {
    expect(daysLabel([2])).toBe('Tuesdays');
    expect(daysLabel([0, 4])).toBe('Thursdays and Sundays');
    expect(daysLabel([5, 1, 3])).toBe('Mondays, Wednesdays and Fridays');
    expect(daysLabel([0, 4], false)).toBe('Thursday and Sunday');
  });

  it('says when a sheet posts', () => {
    expect(sheetTiming({ keep_raids_posted: 2, hours_before: null })).toBe('2 raids posted at a time');
    expect(sheetTiming({ keep_raids_posted: 1, hours_before: null })).toBe('1 raid posted at a time');
    expect(sheetTiming({ keep_raids_posted: null, hours_before: 48 })).toBe('48 hours before each raid');
  });

  it("knows the days other sheets have, not the open sheet's own", () => {
    const sheet = (id: number, channel_id: string, raid_days: number[]): SignupSheet => ({
      id,
      channel_id,
      raid_days,
      keep_raids_posted: 2,
      hours_before: null,
      ping_role_id: null,
      last_posted_at: null
    });
    const sheets = [sheet(1, 'tue', [2]), sheet(2, 'thu', [4, 0])];
    expect([...takenDays(sheets, 1)]).toEqual([
      [4, 'thu'],
      [0, 'thu']
    ]);
    expect(takenDays(sheets, null).size).toBe(3);
  });
});
