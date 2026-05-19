-- ============================================================
-- 188_nomenclature_kind.sql
-- Этап 3 разведения «Номенклатура»/«Документы»: структурный шов
-- kind на позиции номенклатуры. Сейчас единственный реализованный
-- тип — 'ingredient' (синк QuickResto). dish/product/semi_finished
-- объявлены в enum как задел (реализуются позже отдельными этапами).
-- Аддитивно: таблицу/группы не переименовываем (Этап 4), RLS не трогаем.
-- ============================================================

create type public.nomenclature_kind_enum as enum
  ('ingredient', 'dish', 'product', 'semi_finished');

alter table public.inventory_products
  add column if not exists kind public.nomenclature_kind_enum
    not null default 'ingredient';

comment on column public.inventory_products.kind is
  'Тип позиции номенклатуры. ingredient — единственный реализованный '
  '(синк QuickResto). dish/product/semi_finished — задел, реализуются позже.';

create index if not exists inventory_products_kind_idx
  on public.inventory_products(account_id, kind);

grant usage on type public.nomenclature_kind_enum to authenticated, service_role;
