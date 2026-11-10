-- #1542: Find my ticket. One message per Discord server, in a channel
-- everyone there can see, with a button that answers the presser alone with
-- links to their own open recruiting tickets. Teams share a server, so this
-- is kept per server, not per team: the channel an officer picked on
-- Recruiting settings, and the message the bot posted there so it edits or
-- removes that one instead of posting another.
--
-- Only the discord-settings Edge Function reads and writes it, with the
-- service key, after checking the caller may edit recruiting for a team in
-- that server. Nothing on the site reads it directly.
create table public.discord_find_ticket (
  server_id text primary key
    constraint discord_find_ticket_server_id check (server_id ~ '^[0-9]{17,20}$'),
  channel_id text not null
    constraint discord_find_ticket_channel_id check (channel_id ~ '^[0-9]{17,20}$'),
  message_id text
    constraint discord_find_ticket_message_id check (message_id ~ '^[0-9]{17,20}$'),
  guild_id integer not null references public.guilds(id) on delete cascade,
  updated_by integer references public.people(id) on delete set null,
  updated_at timestamp with time zone not null default now()
);

comment on table public.discord_find_ticket is
  'Find my ticket (#1542): per Discord server, the channel its message goes in and the message the bot posted, so the bot edits or removes that one. Read and written by the discord-settings Edge Function for whoever may edit recruiting for a team in the server. Service role only.';
comment on column public.discord_find_ticket.message_id is
  'The posted message; null between picking the channel and the post going through.';
comment on column public.discord_find_ticket.guild_id is
  'The guild whose team first set it. Only that guild''s teams move or remove it, so another guild''s team pointed at the same server can''t (Kat, 2026-11-10).';
comment on column public.discord_find_ticket.updated_by is
  'Who last picked the channel.';

alter table public.discord_find_ticket owner to postgres;
alter table public.discord_find_ticket enable row level security;

create trigger trg_discord_find_ticket_updated_at
  before update on public.discord_find_ticket
  for each row execute function public.set_updated_at();

create policy "Claude readers read discord_find_ticket" on public.discord_find_ticket
  for select to claude_readers using (true);

-- Nobody reads or writes it from the site; the Edge Functions use the
-- service key.
revoke all on table public.discord_find_ticket from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.discord_find_ticket to service_role;
