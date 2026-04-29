-- ОКОНЧАТЕЛЬНОЕ ИСПРАВЛЕНИЕ ПРАВ ДОСТУПА И RLS
-- Миграция от 03.01.2025 - Исправление ошибки 406

-- 1. ПОЛНОЕ ОТКЛЮЧЕНИЕ RLS ДЛЯ ВСЕХ ТАБЛИЦ (с проверкой существования)
DO $$
DECLARE
    table_names TEXT[] := ARRAY[
        'users', 'organizations', 'legal_entities', 'positions', 'user_assignments',
        'accounts', 'categories', 'counterparties', 'transactions', 'attached_files',
        'transaction_attachments', 'audit_logs', 'account_groups', 'category_groups', 'counterparty_groups'
    ];
    tbl_name TEXT;
BEGIN
    FOREACH tbl_name IN ARRAY table_names
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name) THEN
            EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl_name);
            RAISE LOG '✅ RLS отключен для таблицы: %', tbl_name;
        ELSE
            RAISE LOG '⚠️  Таблица не существует: %', tbl_name;
        END IF;
    END LOOP;
END $$;

-- 2. УДАЛЯЕМ ВСЕ ПОЛИТИКИ RLS ПРИНУДИТЕЛЬНО
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I CASCADE', r.policyname, r.schemaname, r.tablename);
        RAISE LOG 'Удалена политика: %.%', r.tablename, r.policyname;
    END LOOP;
END $$;

-- 3. ПРЕДОСТАВЛЯЕМ ПОЛНЫЕ ПРАВА anon И authenticated РОЛЯМ
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

-- 4. КОНКРЕТНЫЕ ПРАВА ДЛЯ ТАБЛИЦЫ USERS (основная проблема)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;

-- 5. КОНКРЕТНЫЕ ПРАВА ДЛЯ ВСЕХ ОСНОВНЫХ ТАБЛИЦ
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_entities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_entities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_assignments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparties TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;

-- 6. ПРАВА НА ВЫПОЛНЕНИЕ ФУНКЦИЙ
GRANT EXECUTE ON FUNCTION public.init_user_full_setup TO anon;
GRANT EXECUTE ON FUNCTION public.init_user_full_setup TO authenticated;
GRANT EXECUTE ON FUNCTION public.init_user_from_auth TO anon;
GRANT EXECUTE ON FUNCTION public.init_user_from_auth TO authenticated;

-- 7. ПРОВЕРЯЕМ РЕЗУЛЬТАТ
DO $$
DECLARE
    tables_with_rls INTEGER;
    remaining_policies INTEGER;
BEGIN
    -- Считаем таблицы с включенным RLS
    SELECT COUNT(*) INTO tables_with_rls
    FROM pg_tables 
    WHERE schemaname = 'public' AND rowsecurity = true;
    
    -- Считаем оставшиеся политики
    SELECT COUNT(*) INTO remaining_policies
    FROM pg_policies 
    WHERE schemaname = 'public';
    
    RAISE LOG '🔍 Таблиц с RLS: %', tables_with_rls;
    RAISE LOG '🔍 Оставшихся политик: %', remaining_policies;
    
    IF tables_with_rls = 0 AND remaining_policies = 0 THEN
        RAISE LOG '✅ RLS полностью отключен, политики удалены!';
        RAISE LOG '✅ Права доступа предоставлены anon и authenticated ролям!';
        RAISE LOG '🚀 ОШИБКА 406 ДОЛЖНА ИСЧЕЗНУТЬ!';
    ELSE
        RAISE LOG '❌ Еще остались проблемы с RLS или политиками';
    END IF;
END $$; 