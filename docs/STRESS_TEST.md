# Stress Testing Guide

There is no isolated test-project setup for this app -- smoke tests run live,
against production, at the actual boundary that exercises them (a real season
rollover, a real new raid tier, etc.). That's a deliberate call: those
boundaries only happen a few times a season, and are low-risk enough (season
archive is reversible via Unarchive, item catalog rows are additive) that a
separate Supabase project isn't worth maintaining.

The actual checklists live on their own issues, run whenever the real-world
trigger for each happens:

- **Season rollover** -- #127 (full workflow), #131 (raid progression archive
  specifically), #155 (unarchive)
- **New raid tier** -- #134 (item catalog repopulation, see #132 for the
  step-by-step)
- **New loot difficulty tier** -- #148 (Champion/Normal priority scoring)

Each of those issues has its own steps and pass criteria -- this doc doesn't
duplicate them.
