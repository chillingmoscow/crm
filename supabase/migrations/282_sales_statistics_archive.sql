begin;
-- Immutable source snapshots. They never replace native daily sales or create
-- financial/payroll operations. Re-imports retain the previous snapshot.
create table public.sales_statistics_archive (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null, venue_id uuid not null,
 month date not null check(extract(day from month)=1),
 metrics jsonb not null check(jsonb_typeof(metrics)='object'),
 weekday_turnover jsonb not null check(jsonb_typeof(weekday_turnover)='array' and jsonb_array_length(weekday_turnover)=7),
 note text not null default '', origin jsonb not null check(jsonb_typeof(origin)='object'),
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 captured_at timestamptz not null, imported_at timestamptz not null default now(),
 imported_by uuid not null references auth.users(id),
 foreign key(account_id,venue_id) references public.venues(account_id,id),
 unique(venue_id,month,captured_at)
);
create index sales_statistics_archive_scope on public.sales_statistics_archive(account_id,venue_id,month desc,captured_at desc);
create index sales_statistics_archive_importer on public.sales_statistics_archive(imported_by);
alter table public.sales_statistics_archive enable row level security;
revoke all on public.sales_statistics_archive from public,anon,authenticated;
grant select on public.sales_statistics_archive to authenticated;
grant select,insert on public.sales_statistics_archive to service_role;
create policy sales_statistics_archive_read on public.sales_statistics_archive
 for select to authenticated using (
  account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id()
  and public.has_permission('sales.view_shifts')
 );
commit;
