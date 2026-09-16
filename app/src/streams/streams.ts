// Guild streams (#286), for the floating live widget (#1102). Recorded against
// the current site's js/streamers.js in tests/behavior/home.js.

export type StreamerRow = {
  id: number;
  team_id: number;
  twitch_channel: string;
  schedule_note: string | null;
  guild_wide_opt_out: boolean;
  is_live: boolean;
  players: { name_realm: string; nickname: string | null } | null;
};

export type Stream = { id: number; name: string; channel: string; note: string };

// The name a streamer goes by: their nickname, or their character's first name.
function displayName(player: StreamerRow['players']): string | null {
  const nameRealm = (player?.name_realm ?? '').trim();
  if (!nameRealm) return null;
  return player?.nickname?.trim() || (nameRealm.split('-')[0] ?? '').trim();
}

// Who is live on this team's pages: the team's own streamers first, then other
// teams' who have not opted out of being shown elsewhere.
export function liveStreams(rows: StreamerRow[], teamId: number): Stream[] {
  const visible = [
    ...rows.filter((r) => r.team_id === teamId),
    ...rows.filter((r) => r.team_id !== teamId && !r.guild_wide_opt_out)
  ];
  return visible.flatMap((r) => {
    const name = displayName(r.players);
    return r.is_live && name ? [{ id: r.id, name, channel: r.twitch_channel, note: r.schedule_note ?? '' }] : [];
  });
}

// "Aur is live!", "Aur and Kestrel are live!", "Aur, Kestrel, and 2 more are live!"
export function liveText(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is live!`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are live!`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more are live!`;
}

// Twitch only plays an embed on a page that names itself as the parent.
export const embedSrc = (channel: string, parent: string) =>
  `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&muted=true`;
