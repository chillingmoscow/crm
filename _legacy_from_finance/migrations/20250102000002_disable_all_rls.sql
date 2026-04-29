-- Отключение Row Level Security для всех таблиц
-- Миграция от 02.01.2025

-- Основные таблицы пользователей и данных
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- Таблицы групп
ALTER TABLE account_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE category_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE counterparty_groups DISABLE ROW LEVEL SECURITY;

-- Таблицы файлов и вложений (если существуют)
ALTER TABLE IF EXISTS attached_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transaction_attachments DISABLE ROW LEVEL SECURITY;

-- Многотенантные таблицы (если существуют)
ALTER TABLE IF EXISTS organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS legal_entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS positions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_assignments DISABLE ROW LEVEL SECURITY;

-- Удаляем все существующие политики RLS (если есть)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Удаляем все политики для всех таблиц в схеме public
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- Выводим статус RLS для всех таблиц (для отладки)
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled,
    CASE 
        WHEN rowsecurity THEN 'ENABLED' 
        ELSE 'DISABLED' 
    END as rls_status
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename; 