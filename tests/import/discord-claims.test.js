import { describe, it, expect } from 'vitest';
import { parseDiscordClaims, discordClaimsSql } from '../../scripts/import/tables/discord-claims.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';

// Discord Claims layout: header row 1; cols A Discord ID, B username,
// C Name-Realm, D Claimed At (ISO).
function claimRows() {
  return [
    ['Discord ID', 'Discord Username', 'Name-Realm', 'Claimed At'],
    ['281652589848690688', 'raeloe', 'Crilynn-Nesingwary', '2026-06-24T00:57:36.769Z'],
    ['1381804848907030629', 'powerful_gull_68584', "Zartunie-Mal'Ganis", '2026-06-29T20:17:24.194Z'],
    ['8.84227E+16', 'sn0wrashi', 'Aeglos-Argent Dawn', '2026-06-29T19:15:29.546Z'],
    ['', '', '', '']
  ];
}

describe('parseDiscordClaims', () => {
  it('keeps snowflake IDs and skips scientific-notation IDs with a warning', () => {
    const { claims, warnings } = parseDiscordClaims(claimRows());
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual({ discordId: '281652589848690688', nameRealm: 'Crilynn-Nesingwary' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('8.84227E+16');
    expect(warnings[0]).toContain('Aeglos-Argent Dawn');
  });

  it('fails loudly on a wrong-tab export', () => {
    const rows = [['Timestamp', 'Character', 'Realm']];
    expect(() => parseDiscordClaims(rows)).toThrow(/expected to contain/);
  });
});

describe('discordClaimsSql', () => {
  it('emits raider rows that fill name_realm only when null on conflict', () => {
    const { claims } = parseDiscordClaims(claimRows());
    const registry = buildPlayerRegistry(['Crilynn-Nesingwary', "Zartunie-Mal'Ganis"]);
    const { sql, count, warnings } = discordClaimsSql(2, claims, registry);
    expect(count).toBe(2);
    expect(warnings).toHaveLength(0);
    expect(sql).toContain("(2, '281652589848690688', 'raider', 'Crilynn-Nesingwary')");
    expect(sql).toContain("'Zartunie-Mal''Ganis'");
    expect(sql).toContain('on conflict (team_id, discord_id) do update set name_realm = excluded.name_realm');
    expect(sql).toContain('where team_members.name_realm is null');
  });

  it('warns when a claim names someone off the roster but still imports it', () => {
    const { claims } = parseDiscordClaims(claimRows());
    const registry = buildPlayerRegistry(['Crilynn-Nesingwary']);
    const { count, warnings } = discordClaimsSql(2, claims, registry);
    expect(count).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Zartunie-Mal'Ganis");
  });

  it('emits a comment for an empty claim set', () => {
    const { sql, count } = discordClaimsSql(2, [], null);
    expect(count).toBe(0);
    expect(sql).toContain('no rows');
  });
});
