-- #1540: a recruit record's history can say the applicant couldn't be added
-- to the team's Discord server when they applied. The discord-join Edge
-- Function writes it (with the reason in detail) next to joined_discord,
-- which it writes when the add works or they were already a member.
alter table public.recruit_events drop constraint recruit_events_kind;
alter table public.recruit_events add constraint recruit_events_kind check (kind in (
  'applied', 'added_by_officer', 'withdrawn', 'joined_discord', 'discord_join_failed', 'ticket_opened',
  'officer_replied', 'reminder_sent', 'trial_started', 'trial_extended', 'declined', 'joined', 'not_joining',
  'closed', 'reopened', 'note_added'));

comment on column public.recruit_events.kind is
  'What happened. joined_discord and discord_join_failed are discord-join''s (#1540): added to the team''s Discord server when they applied (detail ''Already a member'' when they were), or not, with the reason in detail.';
