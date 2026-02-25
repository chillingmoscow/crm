-- ============================================================
-- 019_venue_halls_production.sql
-- Replace demo venue_halls/hall_layouts with production-grade
-- tables: proper UUID FK to venues, RLS policies.
-- ============================================================

-- Drop demo tables (demo-only data, safe to recreate)
drop table if exists public.hall_layouts;
drop table if exists public.venue_halls;
drop index if exists venue_halls_venue_sort_idx;

-- ── venue_halls ─────────────────────────────────────────────
create table public.venue_halls (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references public.venues(id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index venue_halls_venue_sort_idx
  on public.venue_halls (venue_id, sort_order, created_at);

-- ── hall_layouts ─────────────────────────────────────────────
create table public.hall_layouts (
  hall_id        uuid primary key references public.venue_halls(id) on delete cascade,
  canvas_width   integer not null default 1200,
  canvas_height  integer not null default 760,
  objects        jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

-- ── RLS: venue_halls ─────────────────────────────────────────
alter table public.venue_halls enable row level security;

-- SELECT: any active member of the venue
create policy "venue_halls_select"
  on public.venue_halls for select
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.venue_id = venue_halls.venue_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
    )
  );

-- INSERT: owner/manager/admin in the venue
create policy "venue_halls_insert"
  on public.venue_halls for insert
  with check (
    exists (
      select 1 from public.user_venue_roles uvr
      join public.roles r on r.id = uvr.role_id
      where uvr.venue_id = venue_halls.venue_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and r.code in ('owner', 'manager', 'admin')
    )
  );

-- UPDATE: owner/manager/admin in the venue
create policy "venue_halls_update"
  on public.venue_halls for update
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      join public.roles r on r.id = uvr.role_id
      where uvr.venue_id = venue_halls.venue_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and r.code in ('owner', 'manager', 'admin')
    )
  );

-- DELETE: owner/manager/admin in the venue
create policy "venue_halls_delete"
  on public.venue_halls for delete
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      join public.roles r on r.id = uvr.role_id
      where uvr.venue_id = venue_halls.venue_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and r.code in ('owner', 'manager', 'admin')
    )
  );

-- ── RLS: hall_layouts ─────────────────────────────────────────
alter table public.hall_layouts enable row level security;

-- SELECT: any active member of the venue (via hall → venue join)
create policy "hall_layouts_select"
  on public.hall_layouts for select
  using (
    exists (
      select 1 from public.venue_halls vh
      join public.user_venue_roles uvr on uvr.venue_id = vh.venue_id
      where vh.id = hall_layouts.hall_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
    )
  );

-- INSERT: owner/manager/admin
create policy "hall_layouts_insert"
  on public.hall_layouts for insert
  with check (
    exists (
      select 1 from public.venue_halls vh
      join public.user_venue_roles uvr on uvr.venue_id = vh.venue_id
      join public.roles r on r.id = uvr.role_id
      where vh.id = hall_layouts.hall_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and r.code in ('owner', 'manager', 'admin')
    )
  );

-- UPDATE: owner/manager/admin
create policy "hall_layouts_update"
  on public.hall_layouts for update
  using (
    exists (
      select 1 from public.venue_halls vh
      join public.user_venue_roles uvr on uvr.venue_id = vh.venue_id
      join public.roles r on r.id = uvr.role_id
      where vh.id = hall_layouts.hall_id
        and uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and r.code in ('owner', 'manager', 'admin')
    )
  );
