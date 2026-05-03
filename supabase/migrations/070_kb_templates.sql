-- ============================================================
-- 070_kb_templates.sql
-- Sprint B / Tier 2.1 — Шаблоны KB-страниц.
--
-- Зачем: ускорение онбординга («создать SOP по шаблону»),
-- стандартизация регламентов («Чек-лист открытия смены», «Карта
-- рабочего места», «Онбординг сотрудника» — каждый раз одинаковая
-- структура).
--
-- Семантика:
--   - kb_templates — отдельная таблица (НЕ миксин для kb_pages).
--     Шаблон не имеет иерархии, slug, версий, attachments — это
--     просто blueprint для контента + metadata.
--   - При «использовать шаблон» — создаётся новая kb_pages-строка с
--     content = template.content + (заголовок берётся из template.name
--     либо переопределяется юзером).
--   - При «сохранить страницу как шаблон» — копируем content + icon +
--     icon_color, без attachments / backlinks / версий.
--   - Custom-шаблоны видны всем в account (не per-user). Кто создал —
--     не определяет видимость.
--
-- Permissions:
--   kb.manage_templates — CRUD шаблонов (создавать, редактировать,
--                         удалять). UUID …000057.
--   kb.create_pages     — использовать шаблон через создание страницы
--                         (RLS на insert kb_pages уже это проверяет;
--                         server-action useKbTemplate ничего сверх
--                         не требует).
--
-- Дефолтная матрица (как у kb.export_pages / kb.import_pages):
--   owner / admin / accountant / manager — YES
--   hostess / waiter                     — NO (могут только создавать
--                                              страницы из готовых)
-- ============================================================

-- ============================================================
-- 1. Таблица kb_templates
-- ============================================================

create table public.kb_templates (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,

  name        text not null,
  description text,

  -- BlockNote content (массив блоков), такой же shape как у kb_pages.content.
  content     jsonb not null default '[]'::jsonb,

  icon        text,
  icon_color  text,

  -- Категория для группировки в picker'е («Регламенты», «Онбординг»,
  -- «Рецепты»). Свободный текст — UI группирует по distinct.
  category    text,

  -- Системный (account-scoped pre-seeded) vs custom user-created.
  -- На текущем этапе системных нет — флаг для будущего seed-скрипта.
  is_system_default boolean not null default false,

  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz,
  updated_by  uuid references public.profiles(id)
);

create index kb_templates_account_idx
  on public.kb_templates(account_id, category, name);

comment on table public.kb_templates is
  'Шаблоны KB-страниц. content jsonb совместим с kb_pages.content. '
  'Per-account scope, видны всем участникам account.';

-- ============================================================
-- 2. RLS
-- ============================================================

alter table public.kb_templates enable row level security;

-- SELECT: все участники account могут видеть шаблоны (нужно чтобы
-- picker работал даже у hostess/waiter — они выбирают шаблон при
-- создании страницы).
create policy "kb_templates_select" on public.kb_templates
  for select using (
    account_id = public.get_active_account_id()
  );

-- INSERT / UPDATE / DELETE — только с kb.manage_templates.
create policy "kb_templates_insert" on public.kb_templates
  for insert with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.manage_templates')
  );

create policy "kb_templates_update" on public.kb_templates
  for update using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.manage_templates')
  );

create policy "kb_templates_delete" on public.kb_templates
  for delete using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.manage_templates')
  );

grant select, insert, update, delete on public.kb_templates to authenticated;

-- ============================================================
-- 3. Permission `kb.manage_templates` + default-grants
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000057',
   'kb.manage_templates',
   'Создавать, редактировать и удалять шаблоны страниц',
   'kb');

-- Owner / Manager / Admin / Accountant — granted (та же матрица что у
-- kb.export_pages / kb.import_pages).
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000057'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000002'::uuid),  -- manager
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000006'::uuid)   -- accountant
) as r(role_id);
