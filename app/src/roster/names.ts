// A roster row's display label (#1355), independent of team_members: bare
// (no team_member_id, officer-created) or claimed. Kept apart from the
// component so sorting/status are tested without rendering.

// role is an officer's guess at a bare Name's raid role (Tank/Heal/Melee/
// Ranged), so it can sit under that tab before it has a character. Ignored
// once claimed -- the real role comes from the claimed character's spec.
export type NameRow = { id: number; label: string; team_member_id: number | null; role: string | null };

export type NameStatus = 'bare' | 'claimed';

export type NameEntry = NameRow & { status: NameStatus };

export function toNames(rows: NameRow[]): NameEntry[] {
  return [...rows]
    .map((row) => ({ ...row, status: (row.team_member_id === null ? 'bare' : 'claimed') as NameStatus }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
