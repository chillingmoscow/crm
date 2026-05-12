-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 147_service_role_grants_fixup.sql
--
-- КРИТИЧНЫЙ ФИКС: service_role не имел SELECT/INSERT/UPDATE/DELETE на 28
-- таблицах в public. Это унаследовано от миграции 021, где
-- alter default privileges перевыставлены ТОЛЬКО для anon, authenticated:
--
--   alter default privileges in schema public revoke all on tables from anon, authenticated;
--   alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
--
-- Service_role в этой строке не упомянут — поэтому новые таблицы
-- (созданные после 021) дефолтных грантов для service_role не получали.
--
-- Симптом, который привёл к находке: Documents-tab в карточке сотрудника
-- показывал пустые поля медкнижки/трудоустройства, хотя в DB данные были.
-- page.tsx читал `staff_account_details` через `createAdminClient()`
-- (= service_role) — PostgREST возвращал permission denied, supabase-js
-- интерпретировал как «нет данных», UI рендерил defaults. То же могло
-- происходить везде, где admin client читает таблицы созданные после 021.
--
-- Фикс — два слоя:
--   1. Один-раз: grant на все существующие таблицы public для service_role.
--      Дефолтные привилегии applied только к НОВЫМ объектам, поэтому
--      существующие нужно поправить руками.
--   2. На будущее: alter default privileges для service_role, чтобы новые
--      таблицы автоматически получали грант.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Grant на все существующие таблицы.
grant select, insert, update, delete on all tables in schema public to service_role;

-- 2. Sequences (для столбцов с serial / identity).
grant usage, select on all sequences in schema public to service_role;

-- 3. Routines (functions / procedures) — service_role и так должен иметь
--    execute по умолчанию, но уточняем для consistency.
grant execute on all routines in schema public to service_role;

-- 4. Default privileges для будущих таблиц / sequences / routines.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on routines to service_role;

-- Verify (no-op, just for review): после применения выражение ниже должно
-- быть пустым.
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_type = 'BASE TABLE'
--     and not has_table_privilege('service_role', 'public.' || table_name, 'select');
