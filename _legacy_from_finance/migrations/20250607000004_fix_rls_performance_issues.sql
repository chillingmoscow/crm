-- 🚀 ИСПРАВЛЕНИЕ ПРОБЛЕМ ПРОИЗВОДИТЕЛЬНОСТИ RLS
-- Устраняет все предупреждения Supabase Database Linter
-- Дата: 07.06.2025
-- Исправляет: 29 Auth RLS + 64 Multiple Policies + 3 Duplicate Index = 96 проблем

SET statement_timeout = '10min';

BEGIN;

-- 📊 1. УДАЛЯЕМ ДУБЛИРУЮЩИЕСЯ ИНДЕКСЫ
DO $$
BEGIN
  RAISE LOG 'Удаляем дублирующиеся индексы...';
END $$;

-- Legal Entities - удаляем старый, оставляем новый
DROP INDEX IF EXISTS idx_legal_entities_org;

-- Organizations - удаляем старый, оставляем новый  
DROP INDEX IF EXISTS idx_organizations_owner;

-- Positions - удаляем старый, оставляем новый
DROP INDEX IF EXISTS idx_positions_org;

DO $$
BEGIN
  RAISE LOG 'Удалены 3 дублирующихся индекса';
END $$;

-- 🔄 2. ОПТИМИЗИРУЕМ СУЩЕСТВУЮЩИЕ RLS ПОЛИТИКИ
-- Заменяем auth.uid() на (SELECT auth.uid()) для производительности

DO $$
BEGIN
  RAISE LOG 'Оптимизируем RLS политики...';
END $$;

-- Удаляем все существующие политики
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
    END LOOP;
    
    RAISE LOG 'Все старые RLS политики удалены';
END $$;

-- 🏢 ORGANIZATIONS - оптимизированные и объединенные политики
CREATE POLICY "organizations_access" ON organizations
  FOR ALL TO authenticated USING (
    owner_id = (SELECT auth.uid()) OR 
    EXISTS (
      SELECT 1 FROM user_assignments ua
      WHERE ua.user_id = (SELECT auth.uid()) 
        AND ua.organization_id = organizations.id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 🏛️ LEGAL_ENTITIES - объединенные политики
CREATE POLICY "legal_entities_access" ON legal_entities
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = legal_entities.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 📋 POSITIONS - объединенные политики
CREATE POLICY "positions_access" ON positions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = positions.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 🔐 POSITION_PERMISSIONS - объединенные политики
CREATE POLICY "position_permissions_access" ON position_permissions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM positions p
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = position_permissions.position_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 👥 USER_ASSIGNMENTS - объединенные политики
CREATE POLICY "user_assignments_access" ON user_assignments
  FOR ALL TO authenticated USING (
    user_id = (SELECT auth.uid()) OR 
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = user_assignments.organization_id
        AND o.owner_id = (SELECT auth.uid())
    )
  );

-- 💰 ACCOUNTS - объединенные политики
CREATE POLICY "accounts_access" ON accounts
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = accounts.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 📂 CATEGORIES - объединенные политики
CREATE POLICY "categories_access" ON categories
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = categories.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 🤝 COUNTERPARTIES - объединенные политики
CREATE POLICY "counterparties_access" ON counterparties
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = counterparties.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 💸 TRANSACTIONS - объединенные политики
CREATE POLICY "transactions_access" ON transactions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = transactions.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 📦 ACCOUNT_GROUPS - объединенные политики
CREATE POLICY "account_groups_access" ON account_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = account_groups.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 📦 CATEGORY_GROUPS - объединенные политики
CREATE POLICY "category_groups_access" ON category_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = category_groups.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 📦 COUNTERPARTY_GROUPS - объединенные политики
CREATE POLICY "counterparty_groups_access" ON counterparty_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = counterparty_groups.organization_id
        AND (
          o.owner_id = (SELECT auth.uid()) OR
          EXISTS (
            SELECT 1 FROM user_assignments ua
            WHERE ua.user_id = (SELECT auth.uid()) 
              AND ua.organization_id = o.id
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
          )
        )
    )
  );

-- 👤 USERS - объединенные политики
CREATE POLICY "users_access" ON users
  FOR ALL TO authenticated USING (
    id = (SELECT auth.uid()) OR
    (organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = users.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ))
  );

DO $$
BEGIN
  RAISE LOG 'Создано 12 оптимизированных RLS политик (было 64 дублирующихся)';
END $$;

COMMIT; 