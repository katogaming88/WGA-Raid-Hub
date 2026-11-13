// The Help page's content (#1526, laid out by #1666): one page for everyone,
// with officer jobs behind a checkbox. Steps name what the screen shows today; a guide for a page that is
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
  'sign-in': 'Sign in with Battle.net, at the bottom of the sidebar',
  'my-profile': 'My profile in the sidebar',
  calendar: 'Calendar in the sidebar',
  roster: 'Roster in the sidebar',
  'officer-settings': 'Settings in the sidebar’s Officer menu',
  'officer-boss-groups': 'Boss groups under Attendance in the sidebar’s Officer menu',
  'officer-manage': 'Manage under Attendance in the sidebar’s Officer menu',
  'new-team': 'New team at the bottom of the team picker, open at the top of the sidebar'
};

export type TopicId = 'start' | 'loot' | 'raid' | 'gear';

export const TOPICS: { id: TopicId; title: string }[] = [
  { id: 'start', title: 'Getting started' },
  { id: 'loot', title: 'Wishlist and loot priority' },
  { id: 'raid', title: 'Raid nights and attendance' },
  { id: 'gear', title: 'Gear from outside the raid' }
];

const PROFILE: Place = { label: 'My profile', to: (b) => `${b.team}/me` };

export const GUIDES: Guide[] = [
  {
    id: 'sign-in',
    topic: 'start',
    title: 'Sign in',
    quick: 'Sign in with Battle.net, then connect the Discord account you use in the guild.',
    menu: 'sign-in',
    marked: [1],
    steps: [
      'Choose Sign in with Battle.net at the bottom of the sidebar. On a phone, open the menu first.',
      'A card then asks you to connect your Discord. Your team roles and raid notifications come from Discord, so connect the account you use in the guild.',
      'If you already used WGA Raid Hub with Discord, choose Already use WGA Raid Hub with Discord? so Battle.net joins that account instead of starting a new one.'
    ]
  },
  {
    id: 'apply',
    topic: 'start',
    title: 'Apply to a raid team',
    quick: 'Open Join us, pick a team, and send its short application. Your ticket with the officers opens in Discord.',
    place: { label: 'Join us', to: (b) => `${b.guild}/apply` },
    steps: [
      'Open Join us in the sidebar. Each team shows when it raids in your own time zone, its progress and who it’s looking for. Pick what you play under I play to see which teams need you.',
      'Choose Apply on a team that uses the form. A team that says Open a Discord ticket instead takes people in its Discord: open the ticket and chat with its officers there.',
      'Sign in with Battle.net and pick the character you’d raid on. Its item level, Mythic+ score and logs fill in on their own; you don’t type them.',
      'Answer the questions. Anything marked optional can be skipped. If a recruiter sent you a link, Who sent you? is already filled in.',
      'Choose Send application. Discord then asks to “join servers for you”: that’s how you’re added to the team’s Discord, where your private ticket with the officers opens.',
      'Choose Open my ticket in Discord and say hi. Your application is already posted there. You can check where it stands, or withdraw it, under My applications.'
    ]
  },
  {
    id: 'recruiting-settings',
    topic: 'start',
    title: 'Set up recruiting',
    officers: true,
    quick:
      'Recruiting settings in the Officer menu say whether your team takes applications, what your apply page shows and what the bot does in Discord.',
    place: { label: 'Recruiting settings', to: (b) => `${b.team}/officer/recruiting/settings` },
    steps: [
      'Open Recruiting under the Officer menu, then Settings. Seven sections open one at a time; a tick on a heading means it is done.',
      'Recruiting: turn on Taking applications, and pick whether people fill in the form on Raid Hub or open a ticket in your Discord. Add the ticket link if it is a ticket.',
      'About the team, How you raid and What you ask for fill in your public apply page. Raid nights come from your schedule, so they never go out of date.',
      'Application questions: turn starter questions on or off and mark them Required, and add your own. Grey text is exactly what applicants see.',
      'Who you are looking for: add the specs you need and how much. High shows first and gets a Needs you tag when an applicant picks that role.',
      'Discord: pick what the bot does when someone applies. For a private ticket, pick the category tickets are made in, and give the WGA Raid Hub role Manage Channels, Send Messages, Embed Links, Attach Files and Read Message History on that category, plus Manage Roles on the role itself. Pick who can see tickets, and the timings.',
      'Choose Save settings. The bar stays at the bottom, greyed until something changes. See your apply page shows what applicants see.'
    ]
  },
  {
    id: 'recruits',
    topic: 'start',
    title: 'Work with recruits',
    officers: true,
    quick:
      'Recruits in the Officer menu lists everyone who applied or is trying out, where each one stands, and the buttons to move them along.',
    place: { label: 'Recruits', to: (b) => `${b.team}/officer/recruiting` },
    steps: [
      'Open Recruiting under the Officer menu, then Recruits. The tabs are Open, On trial, Joined, Declined and No reply, each with a count. The Recruits item shows how many are waiting on officers.',
      'Each row shows the character in its class colour, spec, item level (orange when under your minimum), best logs average and where it is at: Waiting on officers means they wrote last, Waiting on them means you did. A class your Who you are looking for list does not ask for is marked Not on your needs list.',
      'Choose a name to open their record beside the list: their numbers, links to their ticket, Warcraft Logs, Raider.IO and the Armory, their answers, what has happened so far, and any earlier applications to the guild.',
      'Officer notes are never shown to the applicant. Write one and choose Add note.',
      'Start a trial puts them on your roster as a Trial. On trial, the row says which day it is and when it ends, with Joined, Extend trial (it asks why) and Not joining. Decline closes the record, with a reason if you like. The same buttons are on the card in their ticket.'
    ]
  },
  {
    id: 'my-recruits',
    topic: 'start',
    title: 'Recruit for the guild',
    quick:
      'If the guild made you a recruiter, My recruits under You gives you your own links to send, shows who applied through them and lets you leave a note for the officers.',
    place: { label: 'My recruits', to: (b) => `${b.guild}/me/recruits` },
    steps: [
      'Open My recruits under You in the sidebar. It only shows for people the guild has made recruiters; an Owner or Admin switches that on in the Recruiter column of the Members tab.',
      'Your links has one link for each team taking applications, and Not sure yet, which opens the guild page with every team. Choose Copy beside one and send it. Whoever applies through it is credited to you, whichever team they pick.',
      'People you sent lists each person who applied through your link: their spec, team, when they applied and where it is at. Waiting on officers means the officers owe them a reply. The line above says how many applied this month and how many joined.',
      'Choose Add a note under someone to tell their team’s officers what you learned, then Save note. It shows on their application and in their ticket card. The officers see your notes; the applicant never does.'
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
    menu: 'sign-in',
    marked: [1, 2, 3],
    steps: [
      'Sign in with Battle.net and connect your Discord.',
      'Fill in your guild’s name, region and realm. The first team’s name is optional: leave it empty and the team takes the guild’s name.',
      'Choose Create guild. New guilds can’t sign up yet; until they can, ask in the support Discord.'
    ]
  },
  {
    id: 'add-team',
    topic: 'start',
    title: 'Add a team to your guild',
    officers: true,
    quick: 'Guild officers choose New team at the bottom of the team picker and give it a name. You lead the new team.',
    place: { label: 'Guild settings', to: (b) => `${b.guild}/settings` },
    picture: 'The Teams tab of Guild settings, with a team’s Rename button and an unlisted team marked.',
    popup: 'The New team pop-up, with the team name box marked.',
    menu: 'new-team',
    marked: [1, 2, 3, 4],
    steps: [
      'Open the team picker at the top of the sidebar and choose New team. Guild settings, under Guild in the sidebar, has the same button.',
      'Type the team’s name and choose Add team. You land on its home page as its team leader. Its address starts as a short code, like /t/q6v6gljx.',
      'To rename a team, archive it or bring it back, open Guild settings. Renaming leaves the address alone. Change address is there if you want a readable one, like /t/sandbox; the old address keeps working.',
      'Tick Unlisted to keep a team, like a test team, off the team picker and the guild’s pages for anyone not on it. People on it still see it, and it still opens by its address.'
    ]
  },
  {
    id: 'guild-members',
    topic: 'start',
    title: 'Manage your guild’s ranks',
    officers: true,
    quick:
      'The Members tab of Guild settings lists everyone in the guild, with a search box and a rank filter. The Owner changes ranks and hands the guild over.',
    place: { label: 'Members', to: (b) => `${b.guild}/settings/members` },
    picture:
      'The Members tab of Guild settings, with a Member’s name, the box that sets their rank and Hand over ownership marked.',
    popup: 'The Hand over ownership pop-up, with the box for the new Owner’s name marked.',
    marked: [1, 2, 3, 4],
    steps: [
      'Open Guild settings, under Guild in the sidebar, then the Members tab. The Owner and Admins can open it.',
      'Everyone in the guild is listed with their rank (Owner, Admin, Team Lead or Member), their teams and when they last signed in. Anyone on a team is a Member until the Owner promotes them. The first 25 show; choose Show all for the rest.',
      'To find someone, type part of their name or a character name into Search, or pick a rank under Guild rank. The Owner changes a person’s rank with the box in their row. Admins help run the guild; Team Leads can start teams of their own. Admins see the list but cannot change ranks. Owners and Admins also have a Recruiter column: set it to On to make someone a recruiter, who then gets My recruits and their own links.',
      'To give the guild to someone else, the Owner chooses Hand over ownership beside them and types their name to confirm. They become the Owner and you become an Admin; only the new Owner can undo it.'
    ]
  },
  {
    id: 'team-setup',
    topic: 'start',
    title: 'Set up your team',
    officers: true,
    quick: 'Officer Settings › General holds your team’s Warcraft Logs guild, roster size targets and invite link.',
    place: { label: 'Settings', to: (b) => `${b.team}/officer/settings` },
    picture: 'The General settings page, with the Warcraft Logs guild address marked.',
    marked: [1, 2],
    menu: 'officer-settings',
    steps: [
      'In the Officer menu, open Settings.',
      'On General, add your team’s Warcraft Logs guild page and the roster size targets, then choose Save. The invite link your raiders join with is further down the same page.'
    ]
  },
  {
    id: 'discord-setup',
    topic: 'start',
    title: 'Set up Discord for your team',
    officers: true,
    quick:
      'Add the WGA Raid Hub bot to your Discord server, then pick where it posts and who it pings on Settings › Discord.',
    place: { label: 'Discord settings', to: (b) => `${b.team}/officer/settings/discord` },
    steps: [
      'In the Officer menu, open Settings, then Discord.',
      'If the bot isn’t in your server yet, choose Add WGA Raid Hub to Discord, pick your server and authorize it. You need Manage Server in that server. Then come back and choose I’ve added it.',
      'Pick your team’s server. Only servers that you and the bot are both in are listed. Discord lists the bot as offline in the member list; that’s normal, it posts without staying connected.',
      'Choose each kind of post to pick its channel and, if you like, a role to ping. Send test message checks that the bot can post there.',
      'Private channels: the bot only sees public channels on its own. For each private channel it posts in (or the category holding them), in Discord choose Edit Channel, then Permissions, add the WGA Raid Hub role, and turn on View Channel, Send Messages, Embed Links and Read Message History. The page marks any channel still missing one.',
      'Add a signup sheet for each set of raid days that should post in its own channel, and set quiet hours if the bot should stay silent overnight.'
    ]
  },
  {
    id: 'invite',
    topic: 'start',
    title: 'Invite your raiders',
    officers: true,
    quick: 'Make one invite link and post it in your Discord. Anyone who opens it joins the team.',
    place: { label: 'General settings', to: (b) => `${b.team}/officer/settings#invite-link` },
    menu: 'officer-settings',
    marked: [1],
    steps: [
      'In the Officer menu, open Settings. Invite link is on General, below your team’s basics.',
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
    id: 'rsvp',
    topic: 'raid',
    title: 'Say if you’re coming',
    quick: 'On the Calendar, pick the night and give your answer. Anything but Present needs a note.',
    place: { label: 'Calendar', to: (b) => `${b.team}/calendar` },
    menu: 'calendar',
    picture: 'A raid night’s Your answer box: the answers to choose from, the note, and Save.',
    marked: [1, 2, 3],
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

export const guideById = (id: string) => GUIDES.find((g) => g.id === id)!;

// The raid week (#1526, Kat's pick from the mockups; #1666): what to do, in the
// order it comes up. A job is a guide's id, shown under the guide's own title
// and for officers if the guide is. A job with no guide yet is an officer job,
// plain text marked "guide coming", never a link straight to the page.
export type WeekJob = string | { coming: string };

export const WEEK: { title: string; jobs: WeekJob[] }[] = [
  { title: 'First time here', jobs: ['sign-in', 'claim'] },
  {
    title: 'Before raid',
    jobs: ['rsvp', 'wishlist', 'priority', 'boss-groups', { coming: 'Clear waiting reviews' }]
  },
  { title: 'Raid night', jobs: ['bench', 'lineup'] },
  {
    title: 'After raid',
    jobs: [
      'what-you-got',
      'received',
      { coming: 'Import the night’s loot' },
      { coming: 'Fix a drop given to the wrong person' },
      'attendance'
    ]
  }
];

export const isOfficerJob = (job: WeekJob) => typeof job !== 'string' || guideById(job).officers === true;

// How Loot priority works: one line with four stops.
export const LOOT_FLOW: { who: string; title: string; text: string }[] = [
  { who: 'Raider', title: 'Marks BiS on their wishlist', text: 'One item per slot. Pass on what they would not take.' },
  {
    who: 'The Hub',
    title: 'Works out the priority order',
    text: 'From attendance, performance and the tier pieces still needed.'
  },
  {
    who: 'Officers, raid night',
    title: 'Award the drop',
    text: 'The priority order shows in the in-game loot window.'
  },
  {
    who: 'Officers, after raid',
    title: 'Import, and it’s received',
    text: 'The night’s loot is imported and that slot comes off the raider’s list.'
  }
];

// Bringing a guild here: step 1 is for everyone, the rest for whoever runs
// the guild. Each step names the guide it opens.
export const SETUP: { title: string; text: string; guide: string }[] = [
  { title: 'Sign in with Battle.net', text: 'Then connect your Discord.', guide: 'sign-in' },
  { title: 'Create your guild', text: 'Name, realm, and your first team.', guide: 'create-guild' },
  {
    title: 'Add your other teams',
    text: 'More than one raid team? New team, at the bottom of the team picker.',
    guide: 'add-team'
  },
  {
    title: 'Set up your team',
    text: 'Warcraft Logs guild and roster sizes, in officer Settings.',
    guide: 'team-setup'
  },
  { title: 'Bring in your people', text: 'Send one invite link; raiders claim their name.', guide: 'invite' },
  { title: 'Set up loot', text: 'Wishlists and the priority rules.', guide: 'wishlist' }
];

// Guild setup guides that aren't a step of their own.
export const SETUP_ALSO = ['guild-members', 'discord-setup'];

export const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Why do I need to connect both Battle.net and Discord?',
    a: 'Battle.net is how you sign in, and it brings your characters with it, so nobody types them in by hand. Discord is how your team knows you, and the bot needs it to reach you: your team roles and raid notifications come through Discord, and the bot only sends you a direct message when something needs you. Once both are connected, either one signs you in to the same account.'
  },
  {
    q: 'Why am I not first for an item I marked BiS?',
    a: 'On a team using Loot priority, your place comes from attendance, performance (damage dealers only) and the tier pieces you still need (only for actual tier pieces). Someone above you is ahead on one of those. Officers can also give a drop out of order, for example to spread loot around.'
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
    q: 'Why is the item I marked received showing as waiting?',
    a: 'Some items go to an officer to check before they count. Officers find them in Loot, Reviews.'
  },
  {
    q: 'Can my guild use this if we’re not We Go Again?',
    a: 'Not yet. If you’d like to use it for your guild, ask in the support Discord.'
  }
];
