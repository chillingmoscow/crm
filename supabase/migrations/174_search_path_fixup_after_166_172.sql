-- ============================================================
-- 174_search_path_fixup_after_166_172.sql
--
-- Re-fix `function_search_path_mutable` после миграций 166 и 172.
--
-- Миграции 166 (Stage A: roles+departments venue_id scaffolding) и
-- 172 (Stage D: drop account_id) пересоздавали 4 trigger-функции через
-- `CREATE OR REPLACE FUNCTION` БЕЗ блока `SET search_path = ...`.
-- PostgreSQL при OR REPLACE сбрасывает все function attributes, не
-- перечисленные явно — search_path, set by 160, ушёл.
--
-- Эта миграция повторяет ALTER FUNCTION ... SET search_path для тех же
-- 4 функций (3 существовали до 166, 1 новая в 166). Идемпотентно:
-- ALTER ... SET переустанавливает значение без побочных эффектов.
--
-- Памятка на будущее: при `create or replace function` для триггеров,
-- которые шли через 160, явно прописывать `set search_path = public, pg_catalog`
-- в новом определении.
-- ============================================================

alter function public.tg_roles_check_department()           set search_path = public, pg_catalog;
alter function public.tg_roles_check_venue_department()     set search_path = public, pg_catalog;
alter function public.tg_departments_check_head_role()      set search_path = public, pg_catalog;
alter function public.tg_departments_check_venue_consistency() set search_path = public, pg_catalog;
