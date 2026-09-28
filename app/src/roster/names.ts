// A roster row's display label (#1355), independent of team_members: bare
// (no team_member_id, officer-created) or claimed. Kept apart from the
// component so sorting/status are tested without rendering.

export type NameRow = { id: number; label: string; team_member_id: number | null };

export type NameStatus = 'bare' | 'claimed';

export type NameEntry = NameRow & { status: NameStatus };

export function toNames(rows: NameRow[]): NameEntry[] {
  return [...rows]
    .map((row) => ({ ...row, status: (row.team_member_id === null ? 'bare' : 'claimed') as NameStatus }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
