-- ─────────────────────────────────────────────────────────────────────────────
-- 159_departments_grants_fixup.sql
--
-- Прод-баг: createDepartment возвращал { id: null, error: null }. Тост
-- «Подразделение создано» появлялся, но строка не отображалась — drawer
-- не закрывался, redirect не срабатывал. Локально не воспроизводится.
--
-- Параллель — миграция 147_service_role_grants_fixup.sql: тогда таблицы
-- созданные после 021 не получали service_role grant'ов, потому что
-- `alter default privileges` в 021 был задан только для anon/authenticated.
-- 147 пофиксила существующие таблицы И добавила default privileges для
-- service_role. На локалке после 147 все новые таблицы (включая 158
-- departments) получают grant'ы автоматически.
--
-- Но на проде self-hosted Supabase default privileges могут не сработать,
-- если миграция 147 применялась не тем ролом, что 158. ALTER DEFAULT
-- PRIVILEGES действует только на объекты, созданные ТЕМ ЖЕ ролом, что
-- выставлял default. Это известный postgres-footgun.
--
-- Поэтому здесь явно перевыпускаем grant'ы — это no-op для окружений,
-- где они уже есть, и спасает прод, где их может не быть.
-- ─────────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.departments to service_role;

-- Защита от того же сценария для будущих таблиц: повторно применяем
-- default privileges. Идемпотентно.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
