// Who is submitting a contact report, resolved from their own JWT (#957),
// split out of index.ts so it can be tested without a server (#1006 shape).
//
// The Discord id comes from current_discord_id(), which since #1135 reads the
// caller's auth.identities row rather than raw_user_meta_data. That column is
// writable by the account it describes, so taking the id from it let anyone
// have their report render as a mention of somebody else. The RPC runs under
// the caller's own token and answers null for an anonymous caller, which is the
// same answer this used to give them.
//
// The display name still comes from metadata, and that is fine: a forged
// display name is a cosmetic problem, and there is nowhere else to get one.

export type Submitter = { discordId: string | null; username: string | null };

// The narrow slice of supabase-js this needs, so a test can hand it a fake.
export type SubmitterClient = {
  auth: { getUser: () => Promise<{ data: { user: unknown } }> };
  rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
};

export async function resolveSubmitter(
  authHeader: string | null,
  makeClient: (authHeader: string) => SubmitterClient
): Promise<Submitter | null> {
  if (!authHeader) return null;

  const supabase = makeClient(authHeader);
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const meta = ((user as { user_metadata?: unknown }).user_metadata || {}) as Record<string, unknown>;

  // A failed RPC is an unattributed report, not a lost one: the form's whole
  // point is that the message gets through.
  const { data, error } = await supabase.rpc('current_discord_id');

  return {
    discordId: !error && typeof data === 'string' && data !== '' ? data : null,
    username: typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null
  };
}
