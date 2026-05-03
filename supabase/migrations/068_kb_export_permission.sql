-- ============================================================
-- 068_kb_export_permission.sql
-- Новый permission `kb.export_pages` (Sprint A bonus, PR #41).
--
-- Зачем: экспорт страницы в Markdown это фактически выгрузка
-- интеллектуальной собственности компании наружу. По дефолту в KB
-- читать может любой сотрудник (`kb.view_pages` — у hostess/waiter
-- тоже). Скачивать .md — только тем, кому действительно по работе
-- нужно (owner / admin / accountant / manager).
--
-- UX: kb-page-actions.tsx скрывает Download-кнопку без права; server-
-- action exportKbPageAsMarkdown тоже валидирует — клиент не сможет
-- обойти UI direct-call'ом.
--
-- Дефолтная матрица (mirrors 055 §2.3 для kb.create_pages):
--   owner       (000001) — YES
--   manager     (000002) — YES
--   admin       (000003) — YES
--   accountant  (000006) — YES
--   hostess     (000004) — NO
--   waiter      (000005) — NO
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000055',
   'kb.export_pages',
   'Скачивать страницы базы знаний в Markdown',
   'kb');

-- Owner / Admin / Manager / Accountant — granted.
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000055'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000002'::uuid),  -- manager
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000006'::uuid)   -- accountant
) as r(role_id);
