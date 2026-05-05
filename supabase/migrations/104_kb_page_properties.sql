-- ============================================================
-- 104_kb_page_properties.sql
-- KB page properties (Notion-style typed fields).
--
-- Семантика: каждая страница/шаблон имеет массив именованных
-- типизованных полей. Хранятся как jsonb-массив объектов —
-- валидация формы выполняется в TypeScript (zod-схема в
-- src/lib/knowledge/schemas.ts), БД доверяет только envelope (jsonb).
--
-- Shape (per item):
--   { id: nanoid(8), name: string, type: 'text'|'number'|'date'|
--     'checkbox'|'select', value: any, options?: string[] }
--
-- На kb_templates те же properties задают defaults — applyKbTemplate
-- копирует массив с регенерацией id (instance независим от template).
--
-- Permissions: на page properties едут на kb.edit_own_pages /
-- kb.edit_any_page (тех же, что и UPDATE kb_pages). На template
-- properties — на kb.manage_templates (тех же, что и UPDATE kb_templates).
-- Отдельных permission кодов не вводим.
--
-- Без GIN-индекса: фильтрация страниц по property-значениям —
-- backlog.
-- ============================================================

alter table public.kb_pages
  add column properties jsonb not null default '[]'::jsonb;

alter table public.kb_templates
  add column properties jsonb not null default '[]'::jsonb;

comment on column public.kb_pages.properties is
  'KB-property массив: [{id, name, type, value, options?}]. Validation '
  'в TypeScript (см. src/lib/knowledge/schemas.ts).';

comment on column public.kb_templates.properties is
  'KB-property массив (defaults для applyKbTemplate). Тот же shape, '
  'что у kb_pages.properties.';
