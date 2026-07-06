-- Fix #284: the baseline schema pull granted anon and authenticated only
-- REFERENCES/TRIGGER/TRUNCATE/MAINTAIN on every table, never any DML, so
-- Postgres rejected their requests at the grant check, before row-level
-- security was ever consulted. Every access rule in the schema was
-- unreachable for both roles.
--
-- This is additive and does not loosen access: the row-security rules
-- still decide which rows each request can see or touch. This only makes
-- them start applying at all.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
