// The Streams page's one rule (#1102): turn the streamers read into who is
// live and who is not. Recorded behavior lives in tests/behavior/streams.js;
// directory.test.ts checks this against it.

import { displayName, type StreamerRow } from './streams';

// One person in the directory. `team` is the team's display name, `note` is
// their schedule in their own words, or '' when they have not written one.
export type DirectoryStream = {
  id: number;
  name: string;
  channel: string;
  team: string;
  note: string;
};

export type Directory = { live: DirectoryStream[]; offline: DirectoryStream[] };

// Everyone the guild's Streams page shows, split by whether they are live.
//
// The rules, from tests/behavior/streams.js:
//  - A row whose character has no name is left out: there is nothing to label
//    a card with.
//  - A row with guild_wide_opt_out set is left out. This is a guild page, so
//    every reader counts as "outside their team" (same call Guild home makes
//    in guild.ts's guildLive).
//  - The name shown is the nickname if they set one, otherwise their
//    character's first name (the part before the '-'). streams.ts already
//    works this out for the widget.
//  - Both lists keep the order the rows arrived in, which the read has
//    already put in id order.
export function streamDirectory(rows: StreamerRow[], teamNames: Map<number, string>): Directory {
  const live: DirectoryStream[] = [];
  const offline: DirectoryStream[] = [];

  for (const row of rows) {
    const name = displayName(row.players);
    if (name === null) continue;
    if (row.guild_wide_opt_out) continue;
    const stream: DirectoryStream = {
      id: row.id,
      name,
      channel: row.twitch_channel,
      team: teamNames.get(row.team_id) ?? '',
      note: row.schedule_note ?? ''
    };
    if (row.is_live) live.push(stream);
    else offline.push(stream);
  }
  return { live, offline };
}
