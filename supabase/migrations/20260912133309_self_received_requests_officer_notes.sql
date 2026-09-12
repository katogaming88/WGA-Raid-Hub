-- Officers had no way to leave a reason when rejecting a self-received item
-- request -- bis_requests and mplus_exclusion_requests already have this
-- exact column/flow (20260726104512, tab-mplus.js confirmRejectMPlusExclusion),
-- so self_received_requests gets the same shape for parity.
alter table public.self_received_requests
  add column officer_notes text;
