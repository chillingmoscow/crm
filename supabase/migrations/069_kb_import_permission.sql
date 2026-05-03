-- ============================================================
-- 069_kb_import_permission.sql
-- Новый permission `kb.import_pages` (KB import from Markdown).
--
-- Зачем: импорт .md-файлов создаёт страницы в чужой KB-структуре.
-- Это потенциальный вектор «slop'а» от рядового сотрудника, плюс
-- импорт может содержать external-ссылки/изображения, которые мы
-- не хотим засасывать без модерации. Ограничиваем тем же ролям
-- что и export (миграция 068): owner / admin / accountant / manager.
--
-- Server-action importKbPagesFromMarkdown проверяет двойной gate:
--   - kb.import_pages — право на импорт как таковой
--   - kb.create_pages — право создавать страницы (RLS на kb_pages)
--
-- Дефолтная матрица:
--   owner       (000001) — YES
--   manager     (000002) — YES
--   admin       (000003) — YES
--   accountant  (000006) — YES
--   hostess     (000004) — NO
--   waiter      (000005) — NO
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000056',
   'kb.import_pages',
   'Загружать страницы в базу знаний из Markdown-файлов',
   'kb');

insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000056'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000002'::uuid),  -- manager
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000006'::uuid)   -- accountant
) as r(role_id);
