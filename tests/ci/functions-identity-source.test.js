import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFunctionSources } from '../../scripts/ci/functions-to-deploy.js';

// #1135: identity comes from auth.identities, never from user metadata.
//
// The database half of this is pinned by T5 in tests/rls/function-invariants.
// This is the same pin on the Deno side. GoTrue writes the Discord snowflake
// into user_metadata on every OAuth sign-in and the account itself can rewrite
// it, so the copy cannot be removed and must not be read: contact-webhook used
// to take the submitter's id from there, which meant a report could render as
// a mention of somebody else. It calls current_discord_id() now.
//
// The rule is the whole word rather than a shape of expression: no function
// source mentions provider_id at all. Matching `user_metadata.provider_id`
// would miss the form the old code actually used, where the object is
// destructured a few lines earlier and the read is a bare `meta.provider_id`.
// Zero mentions is true today and is the easier promise to keep.
//
// full_name and name out of the same object are untouched: those are display
// values, and a forged display name is cosmetic rather than an escalation.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = listFunctionSources(ROOT);

const METADATA_IDENTITY = /\bprovider_id\b|\braw_user_meta_data\b/;

describe('Edge Functions resolve identity from auth.identities (#1135)', () => {
  it('reads the functions, so the check below cannot pass over nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no function names provider_id at all, so none can read it out of metadata', () => {
    const readers = [];
    for (const { path, source } of files) {
      source.split(/\r?\n/).forEach((line, i) => {
        if (line.trim().startsWith('//')) return;
        if (METADATA_IDENTITY.test(line)) readers.push(`${path}:${i + 1}`);
      });
    }
    expect(readers).toEqual([]);
  });
});
