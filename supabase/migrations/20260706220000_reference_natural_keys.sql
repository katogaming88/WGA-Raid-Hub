-- Natural unique keys for the reference tables, so one-time import SQL (#320)
-- can use ON CONFLICT DO NOTHING and re-runs converge instead of duplicating.
-- classes_specs: one row per class/spec pair.
-- items: item names are the lookup key everywhere (BiS cells, priority rows,
-- pasted loot), matched case-insensitively, so uniqueness is on lower(name).

alter table public.classes_specs
  add constraint classes_specs_class_spec_key unique (class, spec);

create unique index items_lower_name_key on public.items (lower(name));
