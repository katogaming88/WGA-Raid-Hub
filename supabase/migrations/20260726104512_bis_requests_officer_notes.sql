-- #278 follow-up: officers had no way to leave a reason when rejecting a BiS
-- submission or same-link flag -- mplus_exclusion_requests already has this
-- exact column/flow (tab-mplus.js confirmRejectMPlusExclusion), so bis_requests
-- gets the same shape for parity rather than a bespoke mechanism.
alter table public.bis_requests
  add column officer_notes text;
