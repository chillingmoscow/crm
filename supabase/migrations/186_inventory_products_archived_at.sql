-- ============================================================
-- 186_inventory_products_archived_at.sql
-- Soft-archive ингредиентов, пропавших из QuickResto.
-- Источник истины — QuickResto. Hard-delete не делаем: ингредиент
-- ссылается из inventory_document_items (история актов), а также
-- держит локальные поля/поставщиков/журнал. Вместо удаления —
-- помечаем archived_at при полной синхронизации; вернувшиеся —
-- разархивируются (archived_at = null).
-- ============================================================

alter table public.inventory_products
  add column if not exists archived_at timestamptz;

comment on column public.inventory_products.archived_at is
  'Когда ингредиент пропал из QuickResto при полной синхронизации. '
  'NULL = активен. Архивные скрыты из дерева, но сохраняются ради '
  'истории в актах и локальных данных (фото/описание/поставщики/журнал).';

create index if not exists inventory_products_active_idx
  on public.inventory_products(account_id)
  where archived_at is null;
