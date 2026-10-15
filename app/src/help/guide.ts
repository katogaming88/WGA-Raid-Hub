// The Help page's content (#1526): one page for everyone, with officer jobs
// tagged. Steps name what the screen shows today; a guide for a page that is
// still a placeholder (Import, Reviews, Reassign) waits until that page is
// built. Pictures for each guide come from the screenshot script (#1526 part 2).

// Where a guide's "Take me there" goes, below the team or guild the sidebar
// points at. The Help page's own links only ever open guides (Kat,
// 2026-10-15); this button, inside a guide, is the one way off to the page.
export type Bases = { team: string; guild: string };
type Place = { label: string; to: (b: Bases) => string };

export type Guide = {
  id: string;
  topic: TopicId;
  title: string;
  officers?: boolean;
  // The one-line answer at the top of the guide.
  quick: string;
  place?: Place;
  // What the guide's picture shows, for anyone who can't see it; the picture
  // itself is app/public/help-shots/<id>.png, from `npm run help:shots`.
  picture?: string;
  // The steps with an orange marker on the picture; the step list uses the
  // same orange number for them. Kept in step with the picture's markers by a
  // browser test.
  marked?: number[];
  // Step 1 opens a page from the sidebar: a small picture of that part of
  // the sidebar with an orange 1 on the item. Guides that start from the
  // same item share one picture, help-shots/menu-<id>.png (Kat, 2026-10-15).
  menu?: MenuId;
  // A step happens in a pop-up: a picture of it open, help-shots/<id>-popup.png.
  popup?: string;
  steps: string[];
};

export type MenuId = keyof typeof MENUS;

// The sidebar pictures, one per item, and what each shows.
export const MENUS = {
  'my-profile': 'My profile in the sidebar',
  calendar: 'Calendar in the sidebar',
  roster: 'Roster in the sidebar',
  'officer-settings': 'Settings in the sidebar’s Officer menu',
  'officer-invite': 'Invite link under Settings in the sidebar’s Officer menu',
  'officer-boss-groups': 'Boss groups under Attendance in the sidebar’s Officer menu',
  'officer-manage': 'Manage under Attendance in the sidebar’s Officer menu'
};

export type TopicId = 'start' | 'loot' | 'raid' | 'gear';

export const TOPICS: { id: TopicId; title: string; blurb: string }[] = [
  {
    id: 'start',
    title: 'Getting started',
    blurb: 'Signing in, creating a guild, inviting people and claiming your spot.'
  },
  {
    id: 'loot',
    title: 'Wishlist and loot priority',
    blurb: 'Picking your BiS and reading where you stand.'
  },
  { id: 'raid', title: 'Raid nights and attendance', blurb: 'Saying if you’re coming, and keeping attendance right.' },
  { id: 'gear', title: 'Gear from outside the raid', blurb: 'Crafted, M+ and vault items, and asking to stop M+.' }
];

const PROFILE: Place = { label: 'My profile', to: (b) => `${b.team}/me` };

export const GUIDES: Guide[] = [
  {
    id: 'sign-in',
    topic: 'start',
    title: 'Sign in',
    quick: 'Sign in with Battle.net, then connect the Discord account you use in the guild.',
    picture: 'The sidebar, with the Sign in with Battle.net button marked.',
    marked: [1],
    steps: [
      'Choose Sign in with Battle.net at the bottom of the sidebar. On a phone, open the menu first.',
      'A card then asks you to connect your Discord. Your team roles and raid notifications come from Discord, so connect the account you use in the guild.',
      'If you already used WGA Raid Hub with Discord, choose Already use WGA Raid Hub with Discord? so Battle.net joins that account instead of starting a new one.'
    ]
  },
  {
    id: 'create-guild',
    topic: 'start',
    title: 'Create your guild',
    officers: true,
    quick: 'Give your guild’s name, region and realm. Its first team is made at the same time, and you run both.',
    place: { label: 'Create your guild', to: () => '/new-guild' },
    picture: 'The Create your guild form, with its fields and the Create guild button marked.',
    marked: [2, 3],
    steps: [
      'Sign in with Battle.net and connect your Discord.',
      'Fill in your guild’s name, region and realm. The first team’s name is optional: leave it empty and the team takes the guild’s name.',
      'Choose Create guild. New guilds can’t sign up yet; until they can, ask in the support Discord.'
    ]
  },
  {
    id: 'team-setup',
    topic: 'start',
    title: 'Set up your team',
    officers: true,
    quick: 'Officer Settings holds your Warcraft Logs guild, roster size targets and the raids you’re progressing.',
    place: { label: 'Settings', to: (b) => `${b.team}/officer/settings` },
    picture: 'The General settings page, with the Warcraft Logs guild address marked.',
    marked: [1, 2],
    menu: 'officer-settings',
    steps: [
      'In the Officer menu, open Settings.',
      'On General, add your team’s Warcraft Logs guild page and the roster size targets, then choose Save.',
      'On Raid progression, add one block per raid this season, then choose Save Progression.'
    ]
  },
  {
    id: 'invite',
    topic: 'start',
    title: 'Invite your raiders',
    officers: true,
    quick: 'Make one invite link and post it in your Discord. Anyone who opens it joins the team.',
    place: { label: 'Invite link', to: (b) => `${b.team}/officer/invite` },
    menu: 'officer-invite',
    marked: [1],
    steps: [
      'In the Officer menu, open Settings, then Invite link.',
      'Choose how long the link lasts (or No expiry), then Generate link, and copy it into your Discord.',
      'Raiders who open it join the team, then claim their name on the Roster.',
      'If the link gets out, choose Reset link (the old one stops working) or Remove link.'
    ]
  },
  {
    id: 'claim',
    topic: 'start',
    title: 'Claim your spot on the roster',
    quick: 'Find your name on the Roster and choose Claim under it.',
    place: { label: 'Roster', to: (b) => `${b.team}/roster` },
    menu: 'roster',
    marked: [1],
    steps: [
      'Open the Roster and find your name.',
      'Choose Claim under it. If you are signed out, this signs you in with Battle.net first.',
      'If your name isn’t on the Roster, ask an officer to add you.'
    ]
  },
  {
    id: 'wishlist',
    topic: 'loot',
    title: 'Set your wishlist',
    quick: 'Mark one item BiS for each gear slot. Only BiS picks get a loot priority number.',
    place: { label: 'My profile, Wishlist', to: (b) => `${b.team}/me/wishlist` },
    picture: 'The Wishlist tab: a gear slot chosen on the left, and BiS and Pass marks beside its items.',
    marked: [1, 2, 3],
    menu: 'my-profile',
    steps: [
      'Open My profile, then the Wishlist tab.',
      'Pick a gear slot, then mark one item BiS for it. Mark Pass on anything you would not take.',
      'Click a mark again to clear it. Only your BiS picks get a priority number.'
    ]
  },
  {
    id: 'priority',
    topic: 'loot',
    title: 'Check your priority and attendance',
    quick: 'My profile shows your place for every item you want, and your attendance below it.',
    place: PROFILE,
    picture: "My profile's Overview tab: the loot priority card, and the attendance card beside it.",
    marked: [1, 2, 3],
    menu: 'my-profile',
    steps: [
      'Open My profile.',
      'The Overview tab shows your loot priority, one row per item you want.',
      'Below it are your attendance and any flagged nights, the raid nights that counted less than in full.'
    ]
  },
  {
    id: 'what-you-got',
    topic: 'loot',
    title: 'Find what you got',
    quick: 'My profile’s Loot tab lists every item you received this season, newest first.',
    place: { label: 'My profile, Loot', to: (b) => `${b.team}/me/loot` },
    picture: 'My profile’s Loot tab, with the tab and the list of items marked.',
    marked: [1, 2, 3],
    menu: 'my-profile',
    steps: [
      'Open My profile.',
      'Choose the Loot tab.',
      'Each row is an item you received this season, newest first. Raid drops show up once an officer imports the night’s loot.'
    ]
  },
  {
    id: 'received',
    topic: 'gear',
    title: 'Mark an item you got outside the raid',
    quick: 'Mark crafted, M+ or vault gear received from your loot priority list, so it stops counting.',
    place: PROFILE,
    picture: "The loot priority list on My profile, with an item's Mark received button marked.",
    popup: 'The Mark received pop-up, with its difficulty choice marked.',
    marked: [1, 2],
    steps: [
      'On the loot priority list in My profile, choose Mark received next to the item.',
      'Pick the difficulty and how you got it, then choose Mark received. This is only for gear from outside a guild raid: raid drops show up on their own after the loot import.',
      'Some are marked received right away and others go to an officer to review. The app tells you which.'
    ]
  },
  {
    id: 'mplus',
    topic: 'gear',
    title: 'Ask to stop running M+',
    quick: 'Once M+ has nothing left for you, ask to be excluded from the weekly M+ requirement.',
    place: PROFILE,
    menu: 'my-profile',
    marked: [1],
    steps: [
      'Open My profile and find the M+ card. Once you have nothing left to gain from M+, choose Request M+ exclusion.',
      'Tick that you are 6/6 Myth in every slot M+ can fill, say how many of your helm, bracer and belt sockets are filled, and check your Raider.IO link.',
      'An officer reviews the request. If it is rejected you can choose Request again with the details fixed.'
    ]
  },
  {
    id: 'rsvp',
    topic: 'raid',
    title: 'Say if you’re coming',
    quick: 'On the Calendar, pick the night and give your answer. Anything but Present needs a note.',
    place: { label: 'Calendar', to: (b) => `${b.team}/calendar` },
    menu: 'calendar',
    marked: [1],
    steps: [
      'Open the Calendar and pick the raid night.',
      'Under Your answer, choose Present, Late, Leaving early, Tentative or Absent. On an optional night, choose Attending to say you’re in.',
      'Anything but Present needs a note for officers, so they know why. Then choose Save.'
    ]
  },
  {
    id: 'bench',
    topic: 'raid',
    title: 'See if you’re in or benched',
    quick: 'On a raid night in the Calendar, Your bosses tonight shows which bosses you’re in for.',
    place: { label: 'Calendar', to: (b) => `${b.team}/calendar` },
    picture: 'A raid night with the Your bosses tonight card marked: each boss with In or Sitting out.',
    marked: [1, 2],
    menu: 'calendar',
    steps: [
      'Open the Calendar and pick the raid night.',
      'Your bosses tonight lists each boss with In or Sitting out. Not final yet means your officers may still change it.',
      'If there’s no card, your team doesn’t plan that night boss by boss.'
    ]
  },
  {
    id: 'boss-groups',
    topic: 'raid',
    title: 'Plan who’s in for each boss',
    officers: true,
    quick: 'Boss groups holds the usual group for each boss. Every raid night starts as a copy of it.',
    place: { label: 'Boss groups', to: (b) => `${b.team}/officer/groups` },
    picture: 'The Boss groups page: a cell in the grid and the Save groups button marked.',
    marked: [1, 2, 3],
    menu: 'officer-boss-groups',
    steps: [
      'In the Officer menu, open Attendance, then Boss groups. It needs a computer.',
      'Click a cell to put someone in a boss’s group or take them out. Needs a look lists anything short, such as a buff nobody brings.',
      'Choose Save groups. Coming nights nobody has saved for those bosses follow the new groups.'
    ]
  },
  {
    id: 'lineup',
    topic: 'raid',
    title: 'Swap people in and out for one night',
    officers: true,
    quick: 'A raid night’s Boss lineup tab changes who’s in for each boss on that night only.',
    place: { label: 'Calendar', to: (b) => `${b.team}/calendar` },
    picture: 'A raid night’s Boss lineup tab: the tab, a cell in the grid and Save tonight marked.',
    marked: [1, 2, 4, 5],
    menu: 'calendar',
    steps: [
      'Open the Calendar and pick the raid night.',
      'Choose the Boss lineup tab. It needs a computer.',
      'If the night isn’t planned yet, choose Fill from the groups.',
      'Click a cell to swap someone in or out for that boss.',
      'Choose Save tonight. Save to the group also makes it the usual group, so every coming night starts this way.'
    ]
  },
  {
    id: 'attendance',
    topic: 'raid',
    title: 'Mark attendance',
    officers: true,
    quick: 'Refresh from Warcraft Logs after each raid night, fix what it couldn’t tell, then commit the scores.',
    place: { label: 'Manage attendance', to: (b) => `${b.team}/officer/attendance` },
    picture:
      'The Manage attendance page: Refresh from WCL, the raid night picker, and Commit Attendance Scores, marked in order.',
    marked: [1, 2, 3, 4],
    menu: 'officer-manage',
    steps: [
      'In the Officer menu, open Attendance, then Manage.',
      'After each raid night, choose Refresh from WCL.',
      'Pick the night and fix any status it couldn’t tell on its own. Use Exclude Report for a log that wasn’t a real raid night.',
      'Choose Commit Attendance Scores, then Yes, Commit. Loot priority reads these scores.'
    ]
  }
];

// The raid week (#1526, Kat's pick from the mockups): what to do, in the
// order it comes up. A job with a guide opens it; a job without one is plain
// text until its guide is written, never a link straight to the page.
export type WeekJob = { label: string; officers?: boolean; guide?: string };

export const WEEK: { title: string; jobs: WeekJob[] }[] = [
  {
    title: 'Before raid',
    jobs: [
      { label: 'Say if you’re coming', guide: 'rsvp' },
      { label: 'Keep your wishlist current', guide: 'wishlist' },
      { label: 'Check where you stand for loot', guide: 'priority' },
      { label: 'Plan who’s in for each boss', officers: true, guide: 'boss-groups' },
      { label: 'Clear waiting reviews', officers: true }
    ]
  },
  {
    title: 'Raid night',
    jobs: [
      { label: 'See if you’re in or benched', guide: 'bench' },
      { label: 'Swap people in and out by boss', officers: true, guide: 'lineup' }
    ]
  },
  {
    title: 'After raid',
    jobs: [
      { label: 'Find what you got', guide: 'what-you-got' },
      { label: 'Log gear from M+, crafting or the vault', guide: 'received' },
      { label: 'Import the night’s loot', officers: true },
      { label: 'Fix a drop given to the wrong person', officers: true },
      { label: 'Check attendance', officers: true, guide: 'attendance' }
    ]
  }
];

// Bringing a guild here: step 1 is for everyone, the rest for whoever runs
// the guild.
export const SETUP: { title: string; text: string; guide?: string }[] = [
  { title: 'Sign in with Battle.net', text: 'Then connect your Discord.', guide: 'sign-in' },
  { title: 'Create your guild', text: 'Name, realm, and your first team.', guide: 'create-guild' },
  {
    title: 'Set up your team',
    text: 'Warcraft Logs guild, roster sizes and raid progression, in officer Settings.',
    guide: 'team-setup'
  },
  { title: 'Bring in your people', text: 'Send one invite link; raiders claim their name.', guide: 'invite' },
  { title: 'Set up loot', text: 'Wishlists and the priority rules.', guide: 'wishlist' }
];

export const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Why am I not first for an item I marked BiS?',
    a: 'On a team using Loot priority, your place comes from attendance, performance (damage dealers only) and the tier pieces you still need. Someone above you is ahead on one of those. Officers can also give a drop out of order, for example to spread loot around.'
  },
  {
    q: 'I got an item last night. Why is it still on my list?',
    a: 'It comes off once an officer imports the night’s loot. Officers: check Loot, Import, and if it went to the wrong character, fix it in Loot, Reassign.'
  },
  {
    q: 'Why isn’t my attendance 100%?',
    a: 'Each raid night since you joined counts by how you were marked, using the share your team’s officers set for each mark. Depending on how your team has set them up, being absent, or late with or without notice, can bring it down. Every night that counted less than in full is listed under Flagged nights on My profile. If one looks wrong, ask an officer.'
  },
  {
    q: 'Why is the item I marked received waiting?',
    a: 'Some items go to an officer to check before they count. Officers find them in Loot, Reviews.'
  },
  {
    q: 'Can my guild use this if we’re not We Go Again?',
    a: 'Not yet. If you’d like to use it for your guild, ask in the support Discord.'
  }
];
