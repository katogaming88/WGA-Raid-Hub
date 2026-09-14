// How the Roster page behaves, written once and checked against both sites
// (#1102 step 1). tests/browser/roster-recorded.test.js runs it against the
// current site's Roster tab, where it was recorded; tests/browser-app/
// roster.test.js runs the same checks against the new app's Roster page.
//
// Each suite answers the page's reads from SCENARIO and turns what the page
// rendered into the plain shape below with its own reader, so the checks never
// depend on either site's markup:
//
//   { groups: [{ label, count, rows: [{ name, character, spec }] }] }
//
// `count` is the number a group heading shows, or null when it shows none.
// `character` is the character name shown beside a nickname, or null.
//
// Intentional differences on the new page are not checked here and are listed
// in the pull request that built it (#870): class-colored names instead of a
// class badge, item level, tier pieces, Trial/Bench/Rotator tags, a role filter
// and a summary panel.

const cs = (klass, spec, role) => ({ class: klass, spec, role });

const player = (id, nameRealm, nickname, classSpec, flags = {}) => ({
  id,
  name_realm: nameRealm,
  nickname,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  classes_specs: classSpec,
  ...flags
});

export const SCENARIO = {
  seasonName: 'Season 3',
  activeSignupSeason: 'Season 4',
  players: [
    player(1, 'Aurelith-Illidan', 'Aur', cs('Warrior', 'Protection', 'Tank')),
    player(2, 'Brightmoor-Illidan', '', cs('Paladin', 'Holy', 'Heal')),
    // Sorts by the nickname, so Cinderfall comes after Emberlyn.
    player(3, 'Cinderfall-Illidan', 'Zed', cs('Mage', 'Frost', 'Ranged')),
    player(4, 'Dawnthistle-Illidan', '', cs('Druid', 'Balance', 'Ranged'), { is_trial: true }),
    player(5, 'Emberlyn-Illidan', 'Em', cs('Priest', 'Shadow', 'Ranged'), { is_bench: true }),
    player(6, 'Frostvale-Illidan', null, cs('Rogue', 'Assassination', 'Melee')),
    // No class and spec yet, so not a roster entry on either site.
    player(7, 'Nospec-Illidan', '', null)
  ],
  incoming: [
    {
      signup_id: 91,
      team_id: 1,
      signup_name_realm: 'Gloamwing-Illidan',
      swap_from_name_realm: null,
      class: 'Shaman',
      spec: 'Elemental',
      role: 'Ranged'
    },
    {
      signup_id: 92,
      team_id: 1,
      signup_name_realm: 'Aldersong-Illidan',
      swap_from_name_realm: null,
      class: 'Monk',
      spec: 'Mistweaver',
      role: 'Heal'
    }
  ]
};

export const EXPECTED_CURRENT = {
  groups: [
    { label: 'Tanks', rows: [{ name: 'Aur', character: 'Aurelith', spec: 'Protection' }] },
    { label: 'Healers', rows: [{ name: 'Brightmoor', character: null, spec: 'Holy' }] },
    { label: 'Melee', rows: [{ name: 'Frostvale', character: null, spec: 'Assassination' }] },
    {
      label: 'Ranged',
      rows: [
        { name: 'Dawnthistle', character: null, spec: 'Balance' },
        { name: 'Em', character: 'Emberlyn', spec: 'Shadow' },
        { name: 'Zed', character: 'Cinderfall', spec: 'Frost' }
      ]
    }
  ]
};

export const EXPECTED_INCOMING = {
  tabLabel: 'Season 4 Roster (Tentative)',
  title: '2 Pending Raiders',
  groups: [
    { label: 'Healers', count: 1, rows: [{ name: 'Aldersong', character: null, spec: 'Mistweaver' }] },
    { label: 'Ranged', count: 1, rows: [{ name: 'Gloamwing', character: null, spec: 'Elemental' }] }
  ]
};

// Group headings and rows, ignoring `count` on the current roster: the current
// site shows none there and the new page shows one, which is an addition.
export function withoutCounts(roster) {
  return {
    groups: roster.groups.map((g) => ({
      label: g.label,
      rows: g.rows.map((r) => ({ name: r.name, character: r.character, spec: r.spec }))
    }))
  };
}
