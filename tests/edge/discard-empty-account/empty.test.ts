// #1101: discard-empty-account removes only a Battle.net sign-in with nothing
// else on it, the account a raider who already uses Discord gets by pressing
// Battle.net first. Rows attached to an account are refused by the database's
// foreign keys; this pins the identity half.
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { isStillReferenced, whyKeep } from '../../../supabase/functions/discard-empty-account/empty.ts';

const account = (...providers: string[]) => ({ id: 'u1', identities: providers.map((provider) => ({ provider })) });

Deno.test('a Battle.net-only account can be discarded', () => {
  assertEquals(whyKeep(account('custom:battlenet')), null);
});

Deno.test('an account with Discord on it is never discarded', () => {
  assertNotEquals(whyKeep(account('custom:battlenet', 'discord')), null);
  assertNotEquals(whyKeep(account('discord')), null);
});

Deno.test('an account with no identities, or no account at all, is refused', () => {
  assertNotEquals(whyKeep(account()), null);
  assertNotEquals(whyKeep({ id: 'u1', identities: null }), null);
  assertNotEquals(whyKeep(null), null);
});

Deno.test('a delete blocked by attached rows reads as still referenced', () => {
  assertEquals(
    isStillReferenced(
      'update or delete on table "users" violates foreign key constraint "team_members_auth_user_id_fkey"'
    ),
    true
  );
  assertEquals(isStillReferenced('network error'), false);
  assertEquals(isStillReferenced(undefined), false);
});
