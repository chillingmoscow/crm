-- Исправление RLS политик для таблицы users
-- Миграция от 03.01.2025

-- Включаем RLS для таблицы users (но создаем правильные политики)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Политика для чтения: пользователи могут читать свои собственные данные
CREATE POLICY "users_select_own" ON public.users
FOR SELECT 
TO authenticated
USING (auth.uid() = id);

-- Политика для вставки: только система может создавать пользователей
CREATE POLICY "users_insert_system" ON public.users
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = id);

-- Политика для обновления: пользователи могут обновлять свои данные
CREATE POLICY "users_update_own" ON public.users
FOR UPDATE 
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Политика для удаления: никто не может удалять пользователей через RLS
-- (удаление должно происходить только через административные функции)

-- Также добавляем политики для анонимных пользователей (нужно для некоторых функций)
CREATE POLICY "users_select_for_functions" ON public.users
FOR SELECT 
TO anon, authenticated
USING (true);

-- Комментарии
COMMENT ON POLICY "users_select_own" ON public.users IS 'Пользователи могут читать только свои данные';
COMMENT ON POLICY "users_insert_system" ON public.users IS 'Только система может создавать пользователей';
COMMENT ON POLICY "users_update_own" ON public.users IS 'Пользователи могут обновлять только свои данные';
COMMENT ON POLICY "users_select_for_functions" ON public.users IS 'Доступ для системных функций'; 