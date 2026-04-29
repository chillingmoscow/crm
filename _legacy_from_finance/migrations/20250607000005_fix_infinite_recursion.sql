-- 🚨 ЭКСТРЕННОЕ ИСПРАВЛЕНИЕ БЕСКОНЕЧНОЙ РЕКУРСИИ
-- Исправляет циклические зависимости в RLS политиках
-- Дата: 07.06.2025

BEGIN;

-- Удаляем все проблемные политики
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
END $$;

-- 👤 USERS - базовая политика без циклических зависимостей
CREATE POLICY "users_basic_access" ON users
  FOR ALL TO authenticated USING (
    id = (SELECT auth.uid())
  );

-- 🏢 ORGANIZATIONS - простая политика только для владельцев
CREATE POLICY "organizations_owner_access" ON organizations
  FOR ALL TO authenticated USING (
    owner_id = (SELECT auth.uid())
  );

-- 👥 USER_ASSIGNMENTS - доступ только к своим назначениям и владельцам организаций
CREATE POLICY "user_assignments_basic_access" ON user_assignments
  FOR ALL TO authenticated USING (
    user_id = (SELECT auth.uid()) OR 
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = user_assignments.organization_id
        AND o.owner_id = (SELECT auth.uid())
    )
  );

-- 🏛️ LEGAL_ENTITIES - доступ через владение организацией
CREATE POLICY "legal_entities_basic_access" ON legal_entities
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = legal_entities.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = legal_entities.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 📋 POSITIONS - доступ через владение организацией
CREATE POLICY "positions_basic_access" ON positions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = positions.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = positions.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 🔐 POSITION_PERMISSIONS - доступ через владение организацией
CREATE POLICY "position_permissions_basic_access" ON position_permissions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM positions p
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = position_permissions.position_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM positions p
      JOIN user_assignments ua ON ua.organization_id = p.organization_id
      WHERE p.id = position_permissions.position_id
        AND ua.user_id = (SELECT auth.uid())
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 💰 ACCOUNTS - доступ через владение организацией
CREATE POLICY "accounts_basic_access" ON accounts
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = accounts.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = accounts.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 📂 CATEGORIES - доступ через владение организацией
CREATE POLICY "categories_basic_access" ON categories
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = categories.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = categories.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 🤝 COUNTERPARTIES - доступ через владение организацией
CREATE POLICY "counterparties_basic_access" ON counterparties
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = counterparties.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = counterparties.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 💸 TRANSACTIONS - доступ через владение организацией
CREATE POLICY "transactions_basic_access" ON transactions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = transactions.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = transactions.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 📦 ACCOUNT_GROUPS - доступ через владение организацией
CREATE POLICY "account_groups_basic_access" ON account_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = account_groups.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = account_groups.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 📦 CATEGORY_GROUPS - доступ через владение организацией
CREATE POLICY "category_groups_basic_access" ON category_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = category_groups.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = category_groups.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

-- 📦 COUNTERPARTY_GROUPS - доступ через владение организацией
CREATE POLICY "counterparty_groups_basic_access" ON counterparty_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = counterparty_groups.organization_id
        AND o.owner_id = (SELECT auth.uid())
    ) OR
    EXISTS (
      SELECT 1 FROM user_assignments ua
      JOIN organizations o ON o.id = ua.organization_id
      WHERE ua.user_id = (SELECT auth.uid())
        AND ua.organization_id = counterparty_groups.organization_id
        AND ua.is_active = TRUE
        AND ua.accepted_at IS NOT NULL
    )
  );

COMMIT; 