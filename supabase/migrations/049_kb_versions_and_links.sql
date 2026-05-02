-- ============================================================
-- 049_kb_versions_and_links.sql
-- Stage 8.0 — Knowledge Base: история версий, backlinks, вложения.
--
-- См. ~/.claude/plans/imperative-swinging-sparrow.md §2.2.
-- ============================================================

-- ───────────────────────── kb_page_versions ─────────────────────────
-- Snapshot контента при сохранении (server action делает diff с предыдущей
-- версией и пишет новую строку только если контент или title изменились).
create table public.kb_page_versions (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references public.kb_pages(id) on delete cascade,
  account_id      uuid not null,
  version_number  integer not null,
  title           text not null,
  content         jsonb not null,
  change_note     text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),

  -- tenant-консистентность page ↔ version.
  constraint kb_page_versions_page_tenant_fkey
    foreign key (account_id, page_id)
    references public.kb_pages (account_id, id)
    on delete cascade,

  constraint kb_page_versions_unique unique (page_id, version_number)
);

create index kb_page_versions_page_idx
  on public.kb_page_versions(page_id, version_number desc);
create index kb_page_versions_account_idx
  on public.kb_page_versions(account_id);

comment on table public.kb_page_versions is
  'История версий страниц БЗ. Snapshot пишется server action''ом при '
  'каждом сохранении, если контент или title изменились.';

-- ───────────────────────── kb_page_links ─────────────────────────
-- Backlinks: автоматически вычисляются из BlockNote `page-link` блоков
-- при сохранении страницы (server action делает delete+insert в TX).
create table public.kb_page_links (
  from_page_id    uuid not null references public.kb_pages(id) on delete cascade,
  to_page_id      uuid not null references public.kb_pages(id) on delete cascade,
  account_id      uuid not null,

  -- Обе страницы должны принадлежать тому же account, что и запись.
  constraint kb_page_links_from_tenant_fkey
    foreign key (account_id, from_page_id)
    references public.kb_pages (account_id, id)
    on delete cascade,
  constraint kb_page_links_to_tenant_fkey
    foreign key (account_id, to_page_id)
    references public.kb_pages (account_id, id)
    on delete cascade,

  primary key (from_page_id, to_page_id)
);

create index kb_page_links_to_idx       on public.kb_page_links(to_page_id);
create index kb_page_links_account_idx  on public.kb_page_links(account_id);

comment on table public.kb_page_links is
  'Backlinks между страницами БЗ (from → to). Пересчитываются server '
  'action''ом savePage из BlockNote-блоков `page-link`.';

-- ───────────────────────── kb_page_attachments ─────────────────────────
-- Pivot между страницей и account_files (см. миграцию 041). Storage
-- bucket — общий `account-attachments`, RLS на нём уже настроен в 045.
create table public.kb_page_attachments (
  page_id         uuid not null references public.kb_pages(id) on delete cascade,
  file_id         uuid not null references public.account_files(id) on delete cascade,
  -- Опциональная подпись/описание вложения внутри страницы.
  caption         text,
  attached_at     timestamptz not null default now(),
  attached_by     uuid references public.profiles(id),

  primary key (page_id, file_id)
);

create index kb_page_attachments_file_idx on public.kb_page_attachments(file_id);

comment on table public.kb_page_attachments is
  'Вложения файлов/картинок в страницы БЗ. Реальный файл — в '
  'account_files. Storage bucket account-attachments.';
