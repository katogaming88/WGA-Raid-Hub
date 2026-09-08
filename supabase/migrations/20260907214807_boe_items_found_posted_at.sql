-- #956: boe_items.found_posted_at, the one-post-per-row claim for the BoE
-- found Discord post.
--
-- boe-webhook takes a row id now instead of posting its request body, and
-- claims the row before it posts, so a replay or a race cannot announce the
-- same find twice. A refused post clears the claim again.
--
-- Service-role only, with no new SQL: check_boe_status_transition() refuses
-- any column outside its metadata list to authenticated, and the UPDATE
-- policy admits neither anon nor a plain raider.

alter table public.boe_items add column found_posted_at timestamptz;

comment on column public.boe_items.found_posted_at is
  'When the BoE Found Discord post for this row was sent (#956). Claimed by boe-webhook through the service role and cleared again if Discord refuses the post; null means the row has never been announced.';

-- Existing rows were all announced under the old shape. Left null, each would
-- be claimable once by anyone who guesses an id at an endpoint that takes no
-- credentials.
update public.boe_items set found_posted_at = created_at where found_posted_at is null;
