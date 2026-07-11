-- Site-wide maintenance mode toggle (#245), same phase as #232 and #231.
--
-- Genuinely site-wide, not per-team -- doesn't fit team_settings. New
-- singleton table (a fixed id=1 row) rather than folding into an existing
-- table. Public read (every page, including anonymous visitors, needs to
-- check this before loading data) with no write policy at all -- like
-- bis_requests/mplus_exclusion_requests/self_received_requests,
-- admin_set_maintenance_mode() (SECURITY DEFINER) below is the only write
-- path.

create table if not exists public.site_settings (
  id integer primary key default 1,
  maintenance_mode boolean not null default false,
  maintenance_message text,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

alter table public.site_settings enable row level security;

create policy "Claude readers read site_settings" on public.site_settings for select to claude_readers using (true);
create policy "Public read site_settings" on public.site_settings for select using (true);

grant references, trigger, truncate, maintain on table public.site_settings to anon;
grant references, trigger, truncate, maintain on table public.site_settings to authenticated;
grant references, trigger, truncate, maintain on table public.site_settings to service_role;
grant select on table public.site_settings to claude_readers;

create or replace function public.admin_set_maintenance_mode(
  p_enabled boolean,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.site_settings
  set maintenance_mode = p_enabled, maintenance_message = p_message, updated_at = now()
  where id = 1;

  perform public.write_audit_log(
    null,
    case when p_enabled then 'maintenance_mode_enabled' else 'maintenance_mode_disabled' end,
    'site_settings',
    null,
    case when p_message is not null then jsonb_build_object('message', p_message) else null end
  );
end;
$$;

revoke all on function public.admin_set_maintenance_mode(boolean, text) from public;
revoke execute on function public.admin_set_maintenance_mode(boolean, text) from anon;
grant execute on function public.admin_set_maintenance_mode(boolean, text) to authenticated;
