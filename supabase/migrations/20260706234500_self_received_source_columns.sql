-- Columns for the Self Received Requests sheet data that had no home in the
-- schema, per the decision on #322: the Source cell mixes a difficulty prefix
-- with the actual source ("Mythic: Bonus Roll" vs "Bonus Roll"), and the
-- priority generator's has-item logic reads that difficulty. The importer
-- (#320) splits the two; the Notes column lands in note.

alter table public.self_received_requests
  add column difficulty text
    constraint self_received_requests_difficulty_check
    check (difficulty in ('Champion', 'Heroic', 'Mythic')),
  add column source text,
  add column note text;
