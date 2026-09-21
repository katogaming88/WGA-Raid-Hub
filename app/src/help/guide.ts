// The Help page's raider guide (#1102), rewritten for the new app: each card
// is one task, with steps that name what the screen shows today. The current
// site's guide described its own Discord login, claim prompt and BiS source
// link, so it was not ported. Sign Up, the Twitch link and picking characters
// are left out until those pages exist (#1162).
export type GuideCard = { title: string; steps: string[] };

export const GUIDE: GuideCard[] = [
  {
    title: 'Sign in',
    steps: [
      'Choose Sign in with Battle.net at the bottom of the sidebar. On a phone, open the menu first.',
      'A card then asks you to connect your Discord. Your team roles and raid notifications come from Discord, so connect the account you use in the guild.',
      'If you already used WGA Raid Hub with Discord, choose Already use WGA Raid Hub with Discord? so Battle.net joins that account instead of starting a new one.'
    ]
  },
  {
    title: 'Set your wishlist',
    steps: [
      'Open My profile, then the Wishlist tab.',
      'Pick a gear slot, then mark one item BiS for it. Mark Pass on anything you would not take.',
      'Click a mark again to clear it. Only your BiS picks get a priority number.'
    ]
  },
  {
    title: 'Check your priority and attendance',
    steps: [
      'Open My profile. The Overview tab shows your loot priority, one row per item you want.',
      'Below it are your attendance and any flagged nights, the raid nights that count against you.'
    ]
  },
  {
    title: 'Mark an item you got outside the raid',
    steps: [
      'On the loot priority list in My profile, choose Mark received next to the item.',
      'Pick the difficulty and how you got it, then send it. This is only for gear from outside a guild raid: raid drops show up on their own after the loot import.',
      'Some are marked received right away and others go to an officer to review. The app tells you which.'
    ]
  },
  {
    title: 'Ask to stop running M+',
    steps: [
      'Open My profile and find the M+ card. Once you have nothing left to gain from M+, choose Request M+ exclusion.',
      'Tick that you are 6/6 Myth in every slot M+ can fill, say how many of your helm, bracer and belt sockets are filled, and check your Raider.IO link.',
      'An officer reviews the request. If it is rejected you can choose Request again with the details fixed.'
    ]
  }
];
