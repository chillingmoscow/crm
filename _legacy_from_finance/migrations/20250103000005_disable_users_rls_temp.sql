-- Временное отключение RLS для таблицы users для упрощения тестирования
-- Миграция от 03.01.2025

-- Удаляем все политики RLS для users
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_insert_system" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_select_for_functions" ON public.users;

-- Временно отключаем RLS для users (для упрощения разработки)
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- Комментарий
COMMENT ON TABLE public.users IS 'RLS временно отключен для упрощения разработки и тестирования'; 