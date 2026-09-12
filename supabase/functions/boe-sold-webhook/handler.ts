// Stub for the red run (#1006); see format.ts.
import type { SaleRow } from './format.ts';

export type { SaleRow };

export interface SaleDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  isBoeManager(authHeader: string): Promise<boolean>;
  isSiteAdmin(authHeader: string): Promise<boolean>;
  readSale(id: number): Promise<SaleRow | null>;
  resolveFinderDiscordId(authHeader: string, id: number): Promise<string | null>;
  managerDiscordIds(): Promise<string[]>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = { fetch: typeof fetch; env: Env; db: SaleDb };

export function handle(_req: Request, _deps: Deps): Promise<Response> {
  throw new Error('unbuilt');
}
