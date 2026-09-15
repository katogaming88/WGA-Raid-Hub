import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useSupabase } from '../data/DataProvider';
import type { Client } from '../lib/supabase';
import { reportError } from '../lib/errors';

// Sign-in (#1101 part 3, decided 2026-09-14): Battle.net is how a person signs
// in, and Discord is linked to the same account, because roles, the bot and
// notifications are keyed on a Discord id. Either login opens the account once
// both are on it.

export const BATTLENET = 'custom:battlenet';
export const DISCORD = 'discord';
export type Provider = typeof BATTLENET | typeof DISCORD;

export type SignedInUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  battleTag: string | null;
  hasBattlenet: boolean;
  hasDiscord: boolean;
};

// What the person was doing when they left for Battle.net or Discord, so the
// page can say how it went when they come back.
export type Intent = 'sign-in' | 'connect-discord' | 'connect-battlenet' | 'switch-to-discord' | 'choose-alts';

// How a round trip to Battle.net or Discord ended, read once at startup.
export type AuthReturn = { intent: Intent | null; error: string | null };

const INTENT_KEY = 'wga-auth-intent';
const PROVIDER_KEY = 'wga-auth-provider';

type SessionValue = {
  user: SignedInUser | null;
  // Set once at startup; cleared when the page has dealt with it.
  authReturn: AuthReturn;
  clearAuthReturn: () => void;
  signIn: (provider: Provider) => Promise<void>;
  connect: (provider: Provider) => Promise<void>;
  // The Battle.net access token from this page load's Battle.net round trip,
  // for reading the account's characters (#942 step 5b). Held in memory only:
  // a reload, or any other sign-in, drops it.
  battlenetToken: string | null;
  // Back from a round trip made to choose alts or to connect Battle.net, so
  // the alts picker opens once on its own.
  openAltsOnReturn: boolean;
  clearOpenAltsOnReturn: () => void;
  // To Battle.net and back for a fresh token, then the picker opens. Only for
  // an account that already has Battle.net connected: on any other, a
  // Battle.net sign-in would make a new account.
  refreshBattlenet: () => Promise<void>;
  // For a Battle.net sign-in that landed on a new, empty account while the
  // person already has one under Discord: remove the empty one, sign in with
  // Discord, and connect Battle.net there when they come back.
  switchToDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

export function userFromSession(session: Session | null): SignedInUser | null {
  if (!session) return null;
  const identities = session.user.identities ?? [];
  const battlenet = identities.find((i) => i.provider === BATTLENET);
  const discord = identities.find((i) => i.provider === DISCORD);
  const claims = (battlenet?.identity_data?.['custom_claims'] ?? {}) as Record<string, unknown>;
  const battleTag = text(claims['battletag']);
  const discordData = (discord?.identity_data ?? {}) as Record<string, unknown>;
  const discordClaims = (discordData['custom_claims'] ?? {}) as Record<string, unknown>;
  const discordName = text(discordClaims['global_name']) ?? text(discordData['full_name']) ?? text(discordData['name']);
  return {
    id: session.user.id,
    // Discord's display name when there is one, since that is what the guild
    // knows people by; otherwise the BattleTag without its number.
    name: discordName ?? battleTag?.split('#')[0] ?? 'Signed in',
    avatarUrl: text(discordData['avatar_url']),
    battleTag,
    hasBattlenet: battlenet !== undefined,
    hasDiscord: discord !== undefined
  };
}

// Reads a refused sign-in or link out of the address. Supabase puts it in the
// hash or the query depending on where it failed.
export function readAuthError(location: { hash: string; search: string }): string | null {
  for (const part of [location.hash.slice(1), location.search.slice(1)]) {
    const description = new URLSearchParams(part).get('error_description');
    if (description) return description;
  }
  return null;
}

const AUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description'];

// The address without Supabase's error parameters. A refused link leaves them
// in the query, and anything built from the address afterwards (the return
// address of the next sign-in) would carry the old error back with it.
export function withoutAuthError(location: { pathname: string; search: string; hash: string }): string {
  const search = new URLSearchParams(location.search);
  AUTH_ERROR_PARAMS.forEach((name) => search.delete(name));
  const hash = new URLSearchParams(location.hash.slice(1));
  const hashIsError = AUTH_ERROR_PARAMS.some((name) => hash.has(name));
  const query = search.toString();
  return location.pathname + (query ? `?${query}` : '') + (hashIsError ? '' : location.hash);
}

export function isAlreadyLinked(error: string | null): boolean {
  return /already linked/i.test(error ?? '');
}

function takeIntent(): { intent: Intent | null; provider: string | null } {
  try {
    const intent = sessionStorage.getItem(INTENT_KEY);
    const provider = sessionStorage.getItem(PROVIDER_KEY);
    sessionStorage.removeItem(INTENT_KEY);
    sessionStorage.removeItem(PROVIDER_KEY);
    return {
      intent:
        intent === 'sign-in' ||
        intent === 'connect-discord' ||
        intent === 'connect-battlenet' ||
        intent === 'switch-to-discord' ||
        intent === 'choose-alts'
          ? intent
          : null,
      provider
    };
  } catch {
    return { intent: null, provider: null };
  }
}

function setIntent(intent: Intent, provider: Provider) {
  try {
    sessionStorage.setItem(INTENT_KEY, intent);
    sessionStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Private windows can refuse storage; only the "how did it go" message is lost.
  }
}

// The session's provider token is whichever login the last round trip used,
// so it is a Battle.net token only when that round trip was to Battle.net.
export function battlenetTokenAfter(
  intent: Intent | null,
  provider: string | null,
  error: string | null,
  providerToken: string | null | undefined
): string | null {
  if (error || !providerToken || provider !== BATTLENET) return null;
  return intent === 'sign-in' || intent === 'connect-battlenet' || intent === 'choose-alts' ? providerToken : null;
}

// Everything startup needs before the first render: the address's error (read
// before supabase-js tidies the address), what the person was doing, and the
// stored session. supabase-js also finishes reading a sign-in callback here,
// which has to happen before the router can redirect the address away.
export async function loadInitialSession(
  client: Client,
  location: Location = window.location
): Promise<{ user: SignedInUser | null; authReturn: AuthReturn; battlenetToken: string | null }> {
  const error = readAuthError(location);
  const { intent, provider } = takeIntent();
  // Read once, then gone from the address, so a reload or the next sign-in
  // does not report it again.
  if (error) window.history.replaceState(window.history.state, '', withoutAuthError(location));
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError) reportError(sessionError, { where: 'sign-in' });
  if (error) reportError(new Error(error), { where: `sign-in:${intent ?? 'unknown'}` });
  return {
    user: userFromSession(data.session),
    authReturn: { intent, error },
    battlenetToken: battlenetTokenAfter(intent, provider, error, data.session?.provider_token)
  };
}

const returnAddress = () => {
  const { origin, pathname, search } = window.location;
  return origin + withoutAuthError({ pathname, search, hash: '' });
};

export function SessionProvider({
  initialUser,
  initialAuthReturn = { intent: null, error: null },
  initialBattlenetToken = null,
  children
}: {
  initialUser: SignedInUser | null;
  initialAuthReturn?: AuthReturn;
  initialBattlenetToken?: string | null;
  children: ReactNode;
}) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(initialUser);
  const [authReturn, setAuthReturn] = useState(initialAuthReturn);
  const [battlenetToken, setBattlenetToken] = useState(initialBattlenetToken);
  const [openAltsOnReturn, setOpenAltsOnReturn] = useState(
    () =>
      initialBattlenetToken !== null &&
      (initialAuthReturn.intent === 'choose-alts' || initialAuthReturn.intent === 'connect-battlenet')
  );
  const userId = useRef(initialUser?.id ?? null);

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const next = userFromSession(session);
      // supabase-js re-announces the same session on focus and on every token
      // refresh. A different person (or nobody) means everything cached was
      // read as someone else; the same person may have gained a login.
      if ((next?.id ?? null) !== userId.current) {
        userId.current = next?.id ?? null;
        queryClient.clear();
        setBattlenetToken(null);
      }
      setUser((current) =>
        current && next && current.hasBattlenet === next.hasBattlenet && current.hasDiscord === next.hasDiscord
          ? current
          : next
      );
    });
    return () => data.subscription.unsubscribe();
  }, [client, queryClient]);

  const value = useMemo<SessionValue>(() => {
    const signIn = async (provider: Provider) => {
      setIntent('sign-in', provider);
      const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: returnAddress() } });
      if (error) throw error;
    };
    return {
      user,
      authReturn,
      clearAuthReturn: () => setAuthReturn({ intent: null, error: null }),
      signIn,
      battlenetToken,
      openAltsOnReturn,
      clearOpenAltsOnReturn: () => setOpenAltsOnReturn(false),
      async refreshBattlenet() {
        setIntent('choose-alts', BATTLENET);
        const { error } = await client.auth.signInWithOAuth({
          provider: BATTLENET,
          options: { redirectTo: returnAddress() }
        });
        if (error) throw error;
      },
      async connect(provider) {
        setIntent(provider === DISCORD ? 'connect-discord' : 'connect-battlenet', provider);
        const { error } = await client.auth.linkIdentity({ provider, options: { redirectTo: returnAddress() } });
        if (error) throw error;
      },
      async switchToDiscord() {
        const { error } = await client.functions.invoke('discard-empty-account', { method: 'POST' });
        if (error) throw error;
        // The account is gone, so only this browser's copy of the session is left to clear.
        await client.auth.signOut({ scope: 'local' });
        setIntent('switch-to-discord', DISCORD);
        const { error: signInError } = await client.auth.signInWithOAuth({
          provider: DISCORD,
          options: { redirectTo: returnAddress() }
        });
        if (signInError) throw signInError;
      },
      async signOut() {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        // Not left to the auth event alone, so the page changes even if the
        // listener missed it.
        userId.current = null;
        setUser(null);
        setBattlenetToken(null);
        queryClient.clear();
      }
    };
  }, [client, queryClient, user, authReturn, battlenetToken, openAltsOnReturn]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession needs a SessionProvider above it');
  return value;
}
