-- ============================================================
-- 189_rename_inventory_to_domain_compat_views.sql
-- Этап 4, Pass 4.1 — физический ренейм таблиц под доменную модель
-- + compat-views под старыми именами (expand-фаза expand/contract).
--
-- Код НЕ меняется этой проходкой: старые имена остаются доступны
-- через auto-updatable VIEW. Переключение кода — Pass 4.2,
-- удаление view — Pass 4.4.
--
-- RLS/триггеры/FK/composite-unique привязаны к таблице по OID и
-- переезжают при RENAME автоматически. Имена констрейнтов/индексов
-- пока остаются старые (косметика — Pass 4.4).
--
-- КРИТИЧНО: view создаётся WITH (security_invoker = true). Иначе
-- (PG15 default false) view исполняется от владельца и ОБХОДИТ RLS
-- вызывающего — security-регресс. С invoker=true RLS базовой
-- (переименованной) таблицы применяется к роли authenticated как
-- раньше; service_role RLS обходит в любом случае.
-- ============================================================

alter table public.inventory_products       rename to ingredients;
alter table public.inventory_product_groups  rename to ingredient_groups;
alter table public.inventory_documents       rename to documents;
alter table public.inventory_document_items  rename to document_items;
alter table public.inventory_stores          rename to stores;

create view public.inventory_products
  with (security_invoker = true) as select * from public.ingredients;
create view public.inventory_product_groups
  with (security_invoker = true) as select * from public.ingredient_groups;
create view public.inventory_documents
  with (security_invoker = true) as select * from public.documents;
create view public.inventory_document_items
  with (security_invoker = true) as select * from public.document_items;
create view public.inventory_stores
  with (security_invoker = true) as select * from public.stores;

comment on view public.inventory_products is
  'Compat-view (Этап 4 Pass 4.1). База — public.ingredients. '
  'Удаляется в Pass 4.4 после код-катовера.';
comment on view public.inventory_product_groups is
  'Compat-view → public.ingredient_groups. Drop в Pass 4.4.';
comment on view public.inventory_documents is
  'Compat-view → public.documents. Drop в Pass 4.4.';
comment on view public.inventory_document_items is
  'Compat-view → public.document_items. Drop в Pass 4.4.';
comment on view public.inventory_stores is
  'Compat-view → public.stores. Drop в Pass 4.4.';

-- Гранты на view — как на исходные таблицы (миграция 122):
-- authenticated читает (RLS базовой таблицы через invoker),
-- service_role — полный CRUD (admin-клиент записи).
revoke all
  on public.inventory_products,
     public.inventory_product_groups,
     public.inventory_documents,
     public.inventory_document_items,
     public.inventory_stores
  from anon, authenticated;

grant select
  on public.inventory_products,
     public.inventory_product_groups,
     public.inventory_documents,
     public.inventory_document_items,
     public.inventory_stores
  to authenticated;

grant select, insert, update, delete
  on public.inventory_products,
     public.inventory_product_groups,
     public.inventory_documents,
     public.inventory_document_items,
     public.inventory_stores
  to service_role;
