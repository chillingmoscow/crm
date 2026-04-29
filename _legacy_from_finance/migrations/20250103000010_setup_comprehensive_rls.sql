-- КОМПЛЕКСНАЯ НАСТРОЙКА RLS И СИСТЕМЫ ПРАВ
-- Миграция от 03.01.2025 - Полная мультитенантность
-- Реализует структуру: Компания -> Юрлица -> Пользователи с должностями и правами

-- 1. СОЗДАЕМ ТАБЛИЦУ ПРАВ ДОЛЖНОСТЕЙ
CREATE TABLE IF NOT EXISTS position_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL, -- 'accounts', 'transactions', 'users', 'counterparties', 'categories', 'reports', 'legal_entities', 'positions', 'account_groups', 'category_groups', 'counterparty_groups'
  access_level TEXT NOT NULL DEFAULT 'none', -- 'none', 'read', 'write', 'full'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  
  UNIQUE(position_id, object_type)
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_position_permissions_position_id ON position_permissions(position_id);
CREATE INDEX IF NOT EXISTS idx_position_permissions_object_type ON position_permissions(object_type);

-- 2. ФУНКЦИИ ДЛЯ ПРОВЕРКИ ПРАВ ДОСТУПА

-- Проверка доступа к организации
CREATE OR REPLACE FUNCTION has_organization_access(user_uuid UUID, org_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Проверяем является ли пользователь владельцем организации
  IF EXISTS (
    SELECT 1 FROM organizations 
    WHERE id = org_uuid AND owner_id = user_uuid
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Проверяем есть ли активное назначение в организации
  RETURN EXISTS (
    SELECT 1 FROM user_assignments ua
    WHERE ua.user_id = user_uuid 
      AND ua.organization_id = org_uuid 
      AND ua.is_active = TRUE
      AND ua.accepted_at IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Проверка доступа к юридическому лицу
CREATE OR REPLACE FUNCTION has_legal_entity_access(user_uuid UUID, legal_entity_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  org_id UUID;
BEGIN
  -- Получаем ID организации юрлица
  SELECT organization_id INTO org_id
  FROM legal_entities 
  WHERE id = legal_entity_uuid;
  
  IF org_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Проверяем является ли владельцем организации
  IF EXISTS (
    SELECT 1 FROM organizations 
    WHERE id = org_id AND owner_id = user_uuid
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Проверяем есть ли назначение на это юрлицо или общее в организации
  RETURN EXISTS (
    SELECT 1 FROM user_assignments ua
    WHERE ua.user_id = user_uuid 
      AND ua.organization_id = org_id
      AND (ua.legal_entity_id = legal_entity_uuid OR ua.legal_entity_id IS NULL)
      AND ua.is_active = TRUE
      AND ua.accepted_at IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Проверка конкретных прав доступа
CREATE OR REPLACE FUNCTION has_permission(
  user_uuid UUID, 
  org_uuid UUID, 
  object_type TEXT, 
  required_level TEXT DEFAULT 'read'
)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
  individual_permissions JSONB;
  access_level TEXT := 'none';
  pos_access_level TEXT;
BEGIN
  -- Проверяем базовый доступ к организации
  IF NOT has_organization_access(user_uuid, org_uuid) THEN
    RETURN FALSE;
  END IF;
  
  -- Владелец организации имеет все права
  IF EXISTS (
    SELECT 1 FROM organizations 
    WHERE id = org_uuid AND owner_id = user_uuid
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Получаем права пользователя из назначения
  SELECT ua.role_type, ua.permissions
  INTO user_role, individual_permissions
  FROM user_assignments ua
  WHERE ua.user_id = user_uuid 
    AND ua.organization_id = org_uuid
    AND ua.is_active = TRUE
    AND ua.accepted_at IS NOT NULL
  LIMIT 1;
  
  -- Проверяем индивидуальные права (приоритет)
  IF individual_permissions ? object_type THEN
    access_level := individual_permissions ->> object_type;
  -- Проверяем права должности через position_permissions
  ELSE
    SELECT pp.access_level INTO pos_access_level
    FROM position_permissions pp
    JOIN user_assignments ua ON ua.position_id = pp.position_id
    WHERE ua.user_id = user_uuid 
      AND ua.organization_id = org_uuid
      AND ua.is_active = TRUE
      AND ua.accepted_at IS NOT NULL
      AND pp.object_type = has_permission.object_type
    LIMIT 1;
    
    IF pos_access_level IS NOT NULL THEN
      access_level := pos_access_level;
    END IF;
  END IF;
  
  -- Для роли admin даем права на управление пользователями по умолчанию
  IF user_role = 'admin' AND object_type IN ('users', 'positions') AND access_level = 'none' THEN
    access_level := 'write';
  END IF;
  
  -- Проверяем соответствует ли уровень доступа требуемому
  RETURN CASE 
    WHEN required_level = 'read' THEN access_level IN ('read', 'write', 'full')
    WHEN required_level = 'write' THEN access_level IN ('write', 'full')
    WHEN required_level = 'full' THEN access_level = 'full'
    ELSE FALSE
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. УДАЛЯЕМ СТАРЫЕ RLS ПОЛИТИКИ
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Удаляем все существующие политики RLS
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I CASCADE', r.policyname, r.schemaname, r.tablename);
    END LOOP;
    
    RAISE LOG '🗑️ Все старые RLS политики удалены';
END $$;

-- 4. ВКЛЮЧАЕМ RLS ДЛЯ ВСЕХ ТАБЛИЦ
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparty_groups ENABLE ROW LEVEL SECURITY;

-- 5. СОЗДАЕМ RLS ПОЛИТИКИ

-- Политики для organizations
CREATE POLICY "users_can_view_their_organizations" ON organizations
  FOR SELECT USING (
    owner_id = auth.uid() OR 
    has_organization_access(auth.uid(), id)
  );

CREATE POLICY "owners_can_manage_organizations" ON organizations
  FOR ALL USING (owner_id = auth.uid());

-- Политики для legal_entities
CREATE POLICY "users_can_view_accessible_legal_entities" ON legal_entities
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_legal_entities_with_permission" ON legal_entities
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'legal_entities', 'write')
  );

-- Политики для positions
CREATE POLICY "users_can_view_organization_positions" ON positions
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_positions_with_permission" ON positions
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'positions', 'write')
  );

-- Политики для position_permissions
CREATE POLICY "users_can_view_position_permissions_in_org" ON position_permissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM positions p 
      WHERE p.id = position_permissions.position_id 
        AND has_organization_access(auth.uid(), p.organization_id)
    )
  );

CREATE POLICY "users_can_manage_position_permissions_with_permission" ON position_permissions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM positions p 
      WHERE p.id = position_permissions.position_id 
        AND has_permission(auth.uid(), p.organization_id, 'positions', 'write')
    )
  );

-- Политики для user_assignments
CREATE POLICY "users_can_view_assignments_in_accessible_orgs" ON user_assignments
  FOR SELECT USING (
    user_id = auth.uid() OR 
    has_organization_access(auth.uid(), organization_id)
  );

CREATE POLICY "users_can_manage_assignments_with_permission" ON user_assignments
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'users', 'write')
  );

-- Политики для accounts
CREATE POLICY "users_can_view_organization_accounts" ON accounts
  FOR SELECT USING (
    has_organization_access(auth.uid(), organization_id) AND
    (legal_entity_id IS NULL OR has_legal_entity_access(auth.uid(), legal_entity_id))
  );

CREATE POLICY "users_can_manage_accounts_with_permission" ON accounts
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'accounts', 'write') AND
    (legal_entity_id IS NULL OR has_legal_entity_access(auth.uid(), legal_entity_id))
  );

-- Политики для categories
CREATE POLICY "users_can_view_organization_categories" ON categories
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_categories_with_permission" ON categories
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'categories', 'write')
  );

-- Политики для counterparties
CREATE POLICY "users_can_view_organization_counterparties" ON counterparties
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_counterparties_with_permission" ON counterparties
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'counterparties', 'write')
  );

-- Политики для transactions
CREATE POLICY "users_can_view_accessible_transactions" ON transactions
  FOR SELECT USING (
    has_organization_access(auth.uid(), organization_id) AND
    (legal_entity_id IS NULL OR has_legal_entity_access(auth.uid(), legal_entity_id))
  );

CREATE POLICY "users_can_manage_transactions_with_permission" ON transactions
  FOR ALL USING (
    has_permission(auth.uid(), organization_id, 'transactions', 'write') AND
    (legal_entity_id IS NULL OR has_legal_entity_access(auth.uid(), legal_entity_id))
  );

-- Политики для групп
CREATE POLICY "users_can_view_organization_account_groups" ON account_groups
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_account_groups_with_permission" ON account_groups
  FOR ALL USING (has_permission(auth.uid(), organization_id, 'accounts', 'write'));

CREATE POLICY "users_can_view_organization_category_groups" ON category_groups
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_category_groups_with_permission" ON category_groups
  FOR ALL USING (has_permission(auth.uid(), organization_id, 'categories', 'write'));

CREATE POLICY "users_can_view_organization_counterparty_groups" ON counterparty_groups
  FOR SELECT USING (has_organization_access(auth.uid(), organization_id));

CREATE POLICY "users_can_manage_counterparty_groups_with_permission" ON counterparty_groups
  FOR ALL USING (has_permission(auth.uid(), organization_id, 'counterparties', 'write'));

-- Политики для users (ограниченный доступ)
CREATE POLICY "users_can_view_themselves" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users_can_update_themselves" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "users_can_view_org_users_with_permission" ON users
  FOR SELECT USING (
    id = auth.uid() OR
    (organization_id IS NOT NULL AND has_permission(auth.uid(), organization_id, 'users', 'read'))
  );

-- 6. ОБНОВЛЯЕМ ФУНКЦИЮ ИНИЦИАЛИЗАЦИИ С ПРАВАМИ
CREATE OR REPLACE FUNCTION init_user_full_setup(
  p_auth_user_id UUID,
  p_email TEXT,
  p_full_name TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_legal_entity_id UUID;
  v_owner_position_id UUID;
  v_assignment_id UUID;
  v_full_name TEXT;
  v_result JSON;
BEGIN
  -- Проверяем, не существует ли уже пользователь
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_auth_user_id) THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'User already exists',
      'message', 'Пользователь уже инициализирован',
      'user_id', p_auth_user_id
    );
  END IF;

  RAISE LOG '🚀 Начинаем инициализацию пользователя: %', p_email;
  
  -- Устанавливаем полное имя
  v_full_name := COALESCE(p_full_name, 'Новый пользователь');
  
  -- 1. Создаем пользователя
  INSERT INTO public.users (id, full_name, email, role, created_at, is_active)
  VALUES (p_auth_user_id, v_full_name, p_email, 'user', NOW(), TRUE)
  RETURNING id INTO v_user_id;
  
  RAISE LOG '✅ Создан пользователь: %', v_user_id;
  
  -- 2. Создаем организацию
  INSERT INTO public.organizations (name, description, owner_id, settings, is_active, created_at)
  VALUES (
    'Личный кабинет - ' || v_full_name,
    'Автоматически созданная персональная организация',
    v_user_id,
    '{"currency": "RUB", "timezone": "Europe/Moscow", "auto_backup": false}'::jsonb,
    TRUE,
    NOW()
  ) RETURNING id INTO v_org_id;
  
  RAISE LOG '✅ Создана организация: %', v_org_id;
  
  -- 3. Создаем юридическое лицо
  INSERT INTO public.legal_entities (name, legal_form, legal_address, actual_address, organization_id, created_at, is_active)
  VALUES (
    v_full_name || ' (ИП)',
    'individual',
    'Не указан',
    'Не указан', 
    v_org_id,
    NOW(),
    TRUE
  ) RETURNING id INTO v_legal_entity_id;
  
  RAISE LOG '✅ Создано юрлицо: %', v_legal_entity_id;
  
  -- 4. Создаем должность владельца
  INSERT INTO public.positions (name, description, organization_id, created_at, is_active)
  VALUES (
    'Владелец',
    'Владелец организации с полными правами',
    v_org_id,
    NOW(),
    TRUE
  ) RETURNING id INTO v_owner_position_id;
  
  RAISE LOG '✅ Создана должность: %', v_owner_position_id;
  
  -- 5. Создаем права для должности владельца
  INSERT INTO public.position_permissions (position_id, object_type, access_level, created_at)
  VALUES 
    (v_owner_position_id, 'accounts', 'full', NOW()),
    (v_owner_position_id, 'transactions', 'full', NOW()),
    (v_owner_position_id, 'categories', 'full', NOW()),
    (v_owner_position_id, 'counterparties', 'full', NOW()),
    (v_owner_position_id, 'users', 'full', NOW()),
    (v_owner_position_id, 'positions', 'full', NOW()),
    (v_owner_position_id, 'legal_entities', 'full', NOW()),
    (v_owner_position_id, 'reports', 'full', NOW()),
    (v_owner_position_id, 'account_groups', 'full', NOW()),
    (v_owner_position_id, 'category_groups', 'full', NOW()),
    (v_owner_position_id, 'counterparty_groups', 'full', NOW());
  
  RAISE LOG '✅ Созданы права должности';
  
  -- 6. Создаем назначение пользователя
  INSERT INTO public.user_assignments (
    user_id, organization_id, legal_entity_id, position_id,
    role_type, permissions, invited_at, accepted_at, is_active
  ) VALUES (
    v_user_id, v_org_id, v_legal_entity_id, v_owner_position_id,
    'owner', '{"all": true}'::jsonb, NOW(), NOW(), TRUE
  ) RETURNING id INTO v_assignment_id;
  
  RAISE LOG '✅ Создано назначение: %', v_assignment_id;
  
  -- 7. Обновляем пользователя с ID организации
  UPDATE public.users SET organization_id = v_org_id WHERE id = v_user_id;
  
  -- 8. Создаем базовые категории доходов
  INSERT INTO public.categories (name, type, color, organization_id, created_by, created_at) VALUES
  ('Зарплата', 'income', '#4CAF50', v_org_id, v_user_id, NOW()),
  ('Продажи', 'income', '#2196F3', v_org_id, v_user_id, NOW()),
  ('Прочие доходы', 'income', '#FF9800', v_org_id, v_user_id, NOW());
  
  -- 9. Создаем базовые категории расходов  
  INSERT INTO public.categories (name, type, color, organization_id, created_by, created_at) VALUES
  ('Офисные расходы', 'expense', '#F44336', v_org_id, v_user_id, NOW()),
  ('Транспорт', 'expense', '#9C27B0', v_org_id, v_user_id, NOW()),
  ('Питание', 'expense', '#795548', v_org_id, v_user_id, NOW()),
  ('Прочие расходы', 'expense', '#607D8B', v_org_id, v_user_id, NOW());
  
  RAISE LOG '✅ Созданы базовые категории';
  
  -- 10. Создаем стартовый счет
  INSERT INTO public.accounts (
    name, balance, currency, description, account_type,
    organization_id, legal_entity_id, created_by, created_at
  ) VALUES (
    'Основной счет', 0.00, 'RUB', 'Основной расчетный счет', 'checking',
    v_org_id, v_legal_entity_id, v_user_id, NOW()
  );
  
  RAISE LOG '✅ Создан стартовый счет';
  
  RETURN json_build_object(
    'success', TRUE,
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'legal_entity_id', v_legal_entity_id,
    'position_id', v_owner_position_id,
    'assignment_id', v_assignment_id,
    'message', 'Пользователь успешно инициализирован с системой прав доступа'
  );
  
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '❌ Ошибка инициализации: %', SQLERRM;
  RETURN json_build_object(
    'success', FALSE,
    'error', SQLERRM,
    'message', 'Ошибка инициализации пользователя'
  );
END;
$$;

-- 7. СОЗДАЕМ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ КЛИЕНТА

-- Функция получения прав пользователя
CREATE OR REPLACE FUNCTION get_user_permissions(org_uuid UUID DEFAULT NULL)
RETURNS TABLE(
  object_type TEXT,
  access_level TEXT,
  source TEXT -- 'position' | 'individual' | 'owner'
) AS $$
DECLARE
  user_org_id UUID;
BEGIN
  -- Определяем организацию
  user_org_id := COALESCE(org_uuid, (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));
  
  IF user_org_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Если владелец - возвращаем полные права
  IF EXISTS (SELECT 1 FROM organizations WHERE id = user_org_id AND owner_id = auth.uid()) THEN
    RETURN QUERY
    SELECT 
      unnest(ARRAY['accounts', 'transactions', 'categories', 'counterparties', 'users', 'positions', 'legal_entities', 'reports', 'account_groups', 'category_groups', 'counterparty_groups'])::TEXT,
      'full'::TEXT,
      'owner'::TEXT;
    RETURN;
  END IF;
  
  -- Возвращаем права из position_permissions
  RETURN QUERY
  SELECT pp.object_type, pp.access_level, 'position'::TEXT as source
  FROM position_permissions pp
  JOIN user_assignments ua ON ua.position_id = pp.position_id
  WHERE ua.user_id = auth.uid() 
    AND ua.organization_id = user_org_id
    AND ua.is_active = TRUE
    AND ua.accepted_at IS NOT NULL;
    
  -- Добавляем индивидуальные права
  RETURN QUERY
  SELECT 
    key::TEXT as object_type,
    value::TEXT as access_level,
    'individual'::TEXT as source
  FROM user_assignments ua,
       jsonb_each_text(ua.permissions)
  WHERE ua.user_id = auth.uid() 
    AND ua.organization_id = user_org_id
    AND ua.is_active = TRUE
    AND ua.accepted_at IS NOT NULL
    AND key != 'all'; -- исключаем специальный ключ 'all'
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция проверки статуса инициализации
CREATE OR REPLACE FUNCTION check_user_initialization_status()
RETURNS JSON AS $$
DECLARE
  user_id UUID := auth.uid();
  user_exists BOOLEAN := FALSE;
  org_exists BOOLEAN := FALSE;
  assignment_exists BOOLEAN := FALSE;
  result JSON;
BEGIN
  -- Проверяем существование пользователя
  SELECT EXISTS(SELECT 1 FROM users WHERE id = user_id) INTO user_exists;
  
  IF NOT user_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User not found in system'
    );
  END IF;
  
  -- Проверяем есть ли организация
  SELECT EXISTS(
    SELECT 1 FROM organizations o
    JOIN users u ON u.organization_id = o.id
    WHERE u.id = user_id
  ) INTO org_exists;
  
  IF NOT org_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no organization'
    );
  END IF;
  
  -- Проверяем есть ли назначение
  SELECT EXISTS(
    SELECT 1 FROM user_assignments ua
    WHERE ua.user_id = user_id 
      AND ua.is_active = TRUE
      AND ua.accepted_at IS NOT NULL
  ) INTO assignment_exists;
  
  IF NOT assignment_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no active assignments'
    );
  END IF;
  
  RETURN json_build_object(
    'initialized', TRUE,
    'message', 'User fully initialized'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. СОЗДАЕМ ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ
CREATE INDEX IF NOT EXISTS idx_user_assignments_user_org ON user_assignments(user_id, organization_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_assignments_org_legal ON user_assignments(organization_id, legal_entity_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_legal_entities_org ON legal_entities(organization_id);
CREATE INDEX IF NOT EXISTS idx_positions_org ON positions(organization_id);

-- Логируем успешное завершение
DO $$
BEGIN
  RAISE LOG '🎉 Комплексная система RLS успешно настроена!';
  RAISE LOG '📋 Созданы таблицы: position_permissions';
  RAISE LOG '🔐 Настроены RLS политики для всех таблиц';
  RAISE LOG '⚙️ Созданы функции проверки прав доступа';
  RAISE LOG '✅ Система готова к использованию';
END $$; 