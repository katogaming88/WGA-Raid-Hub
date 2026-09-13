// Where a Discord post goes (#1081). Stub for the red run; every function
// throws a word no assertion uses, and the constants are placeholders.

export const PLATFORM_URL = 'SUPABASE_URL';
export const PRODUCTION_HOST = 'unbuilt';
export const TEST_WEBHOOK = 'DISCORD_TEST_WEBHOOK_URL';

export const DESTINATIONS = {} as Record<string, readonly string[]>;

export type DestinationKey = string;
export type Env = { get(name: string): string | undefined };
export type Source = 'production' | 'local';
export type Destination =
  { kind: 'post'; url: string; source: Source; via: string } | { kind: 'skip'; reason?: string };

export function isProductionStack(_env: Env): boolean {
  throw new Error('unbuilt');
}

export function isLocalStack(_env: Env): boolean {
  throw new Error('unbuilt');
}

export function resolveDestination(_env: Env, _opts: { destination: DestinationKey }): Destination {
  throw new Error('unbuilt');
}

export function marker(_source: Source): string | null {
  throw new Error('unbuilt');
}

export function allowedMentions(_source: Source, _users: string[]): { parse: never[]; users: string[] } {
  throw new Error('unbuilt');
}
