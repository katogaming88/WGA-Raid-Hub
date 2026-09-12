// Stubs for the red run (#1006). Every export exists with its real signature
// so the tests type-check, and every body throws a word the assertions never
// use, so a pass in the red run is a defect in the test.
export type SaleRow = {
  id: number;
  team_id: number;
  finder_name: string | null;
  item_name: string | null;
  track: string | null;
  upgrade_rank: string | null;
  status: string;
  sale_price: unknown;
  ah_fee: unknown;
  guild_cut: unknown;
  finder_payout: unknown;
  payout_donated: boolean | null;
};

export type SoldPost = {
  username: string;
  content: string;
  allowed_mentions: { parse: never[]; users: string[] };
};

export function joinNames(_names: string[]): string {
  throw new Error('unbuilt');
}

export function gold(_n: unknown): string {
  throw new Error('unbuilt');
}

export function oneLine(_s: unknown): string {
  throw new Error('unbuilt');
}

export function itemLine(_row: Pick<SaleRow, 'track' | 'item_name' | 'upgrade_rank'>): string {
  throw new Error('unbuilt');
}

export function finderText(_finderId: string | null, _finderName: unknown): string {
  throw new Error('unbuilt');
}

export function moneyLines(_row: Pick<SaleRow, 'sale_price' | 'ah_fee' | 'guild_cut' | 'finder_payout'>): string[] {
  throw new Error('unbuilt');
}

export function closing(_payoutDonated: boolean | null | undefined, _managerIds: string[]): string {
  throw new Error('unbuilt');
}

export function soldPost(_row: SaleRow, _finderId: string | null, _managerIds: string[]): SoldPost {
  throw new Error('unbuilt');
}
