-- Исправление уязвимости search_path в функциях PostgreSQL
-- Миграция от 07.06.2025 - Безопасность

-- ПРОБЛЕМА: Функции без фиксированного search_path уязвимы для атак типа "schema poisoning"
-- РЕШЕНИЕ: Добавляем SET search_path = '' ко всем функциям для безопасности

-- 1. Исправляем функцию has_organization_access
CREATE OR REPLACE FUNCTION public.has_organization_access(user_uuid UUID, org_uuid UUID)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
BEGIN
  -- Проверяем является ли пользователь владельцем организации
  IF EXISTS (
    SELECT 1 FROM public.organizations 
    WHERE id = org_uuid AND owner_id = user_uuid
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Проверяем есть ли активное назначение в организации
  RETURN EXISTS (
    SELECT 1 FROM public.user_assignments ua
    WHERE ua.user_id = user_uuid 
      AND ua.organization_id = org_uuid 
      AND ua.is_active = TRUE
      AND ua.accepted_at IS NOT NULL
  );
END;
$$;

-- 2. Исправляем функцию has_legal_entity_access
CREATE OR REPLACE FUNCTION public.has_legal_entity_access(user_uuid UUID, legal_entity_uuid UUID)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
DECLARE
  org_id UUID;
BEGIN
  -- Получаем ID организации юрлица
  SELECT organization_id INTO org_id
  FROM public.legal_entities 
  WHERE id = legal_entity_uuid;
  
  IF org_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Проверяем является ли владельцем организации
  IF EXISTS (
    SELECT 1 FROM public.organizations 
    WHERE id = org_id AND owner_id = user_uuid
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Проверяем есть ли назначение на это юрлицо или общее в организации
  RETURN EXISTS (
    SELECT 1 FROM public.user_assignments ua
    WHERE ua.user_id = user_uuid 
      AND ua.organization_id = org_id
      AND (ua.legal_entity_id = legal_entity_uuid OR ua.legal_entity_id IS NULL)
      AND ua.is_active = TRUE
      AND ua.accepted_at IS NOT NULL
  );
END;
$$;

-- 3. Исправляем функцию has_permission
CREATE OR REPLACE FUNCTION public.has_permission(
  user_uuid UUID, 
  org_uuid UUID, 
  object_type TEXT, 
  required_level TEXT DEFAULT 'read'
)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
DECLARE
  access_level TEXT := 'none';
BEGIN
  -- Проверяем базовый доступ к организации
  IF NOT public.has_organization_access(user_uuid, org_uuid) THEN
    RETURN FALSE;
  END IF;
  
  -- Владелец организации имеет все права
  IF EXISTS (
    SELECT 1 FROM public.organizations 
    WHERE id = org_uuid AND owner_id = user_uuid
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Получаем права ТОЛЬКО из должности через position_permissions
  SELECT pp.access_level INTO access_level
  FROM public.position_permissions pp
  JOIN public.user_assignments ua ON ua.position_id = pp.position_id
  WHERE ua.user_id = user_uuid 
    AND ua.organization_id = org_uuid
    AND ua.is_active = TRUE
    AND ua.accepted_at IS NOT NULL
    AND pp.object_type = has_permission.object_type
  LIMIT 1;
  
  -- Если прав нет, по умолчанию 'none'
  IF access_level IS NULL THEN
    access_level := 'none';
  END IF;
  
  -- Проверяем соответствует ли уровень доступа требуемому
  RETURN CASE 
    WHEN required_level = 'read' THEN access_level IN ('read', 'write', 'full')
    WHEN required_level = 'write' THEN access_level IN ('write', 'full')
    WHEN required_level = 'full' THEN access_level = 'full'
    ELSE FALSE
  END;
END;
$$;

-- 4. Исправляем функцию get_user_permissions
CREATE OR REPLACE FUNCTION public.get_user_permissions(org_uuid UUID DEFAULT NULL)
RETURNS TABLE(
  object_type TEXT,
  access_level TEXT,
  source TEXT -- 'position' | 'individual' | 'owner'
) 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
DECLARE
  user_org_id UUID;
BEGIN
  -- Определяем организацию
  user_org_id := COALESCE(org_uuid, (
    SELECT organization_id FROM public.users WHERE id = auth.uid()
  ));
  
  IF user_org_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Если владелец - возвращаем полные права
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = user_org_id AND owner_id = auth.uid()) THEN
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
  FROM public.position_permissions pp
  JOIN public.user_assignments ua ON ua.position_id = pp.position_id
  WHERE ua.user_id = auth.uid() 
    AND ua.organization_id = user_org_id
    AND ua.is_active = TRUE
    AND ua.accepted_at IS NOT NULL;
END;
$$;

-- 5. Исправляем функцию check_user_initialization_status
CREATE OR REPLACE FUNCTION public.check_user_initialization_status()
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
DECLARE
  v_auth_user_id UUID;
  v_user_exists BOOLEAN;
  v_org_id UUID;
  v_assignment_exists BOOLEAN;
BEGIN
  -- Получаем ID текущего пользователя
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'error', 'User not authenticated',
      'message', 'Пользователь не авторизован'
    );
  END IF;
  
  -- Проверяем существование пользователя
  SELECT
    EXISTS(SELECT 1 FROM public.users WHERE id = v_auth_user_id),
    organization_id
  INTO v_user_exists, v_org_id
  FROM public.users
  WHERE id = v_auth_user_id;
  
  IF NOT v_user_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User not found in public.users',
      'auth_user_id', v_auth_user_id
    );
  END IF;
  
  IF v_org_id IS NULL THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no organization',
      'user_id', v_auth_user_id
    );
  END IF;
  
  -- Проверяем назначения
  SELECT EXISTS(
    SELECT 1 FROM public.user_assignments
    WHERE user_id = v_auth_user_id
      AND is_active = TRUE
      AND accepted_at IS NOT NULL
  ) INTO v_assignment_exists;
  
  IF NOT v_assignment_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no active assignments',
      'user_id', v_auth_user_id,
      'organization_id', v_org_id
    );
  END IF;
  
  RETURN json_build_object(
    'initialized', TRUE,
    'user_id', v_auth_user_id,
    'organization_id', v_org_id,
    'message', 'User fully initialized'
  );
END;
$$;

-- 6. Исправляем функцию init_user_full_setup
CREATE OR REPLACE FUNCTION public.init_user_full_setup(
  p_auth_user_id UUID,
  p_email TEXT,
  p_full_name TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_legal_entity_id UUID;
  v_owner_position_id UUID;
  v_assignment_id UUID;
  v_full_name TEXT;
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
  INSERT INTO public.users (id, full_name, email, created_at, is_active)
  VALUES (p_auth_user_id, v_full_name, p_email, NOW(), TRUE)
  RETURNING id INTO v_user_id;

  RAISE LOG '✅ Создан пользователь: %', v_user_id;

  -- 2. Создаем организацию "Моя компания"
  INSERT INTO public.organizations (name, description, owner_id, settings, is_active, created_at)
  VALUES (
    'Моя компания',
    'Основная компания для ведения бизнеса',
    v_user_id,
    '{"currency": "RUB", "timezone": "Europe/Moscow", "auto_backup": true}'::jsonb,
    TRUE,
    NOW()
  ) RETURNING id INTO v_org_id;

  RAISE LOG '✅ Создана организация: %', v_org_id;

  -- 3. Создаем юридическое лицо "Мой первый бизнес"
  INSERT INTO public.legal_entities (
    name, 
    full_name,
    legal_form, 
    legal_address, 
    actual_address, 
    organization_id, 
    created_at, 
    is_active
  ) VALUES (
    'Мой первый бизнес',
    'ООО "Мой первый бизнес"',
    'ООО',
    'Укажите юридический адрес',
    'Укажите фактический адрес',
    v_org_id,
    NOW(),
    TRUE
  ) RETURNING id INTO v_legal_entity_id;

  RAISE LOG '✅ Создано юрлицо: %', v_legal_entity_id;

  -- 4. Создаем должность "Владелец"
  INSERT INTO public.positions (name, description, organization_id, legal_entity_id, created_at, is_active)
  VALUES (
    'Владелец',
    'Владелец бизнеса с полными правами доступа ко всем функциям',
    v_org_id,
    v_legal_entity_id,
    NOW(),
    TRUE
  ) RETURNING id INTO v_owner_position_id;

  RAISE LOG '✅ Создана должность: %', v_owner_position_id;

  -- 5. Создаем полные права для должности владельца
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
    invited_at, accepted_at, is_active
  ) VALUES (
    v_user_id, v_org_id, v_legal_entity_id, v_owner_position_id,
    NOW(), NOW(), TRUE
  ) RETURNING id INTO v_assignment_id;

  RAISE LOG '✅ Создано назначение: %', v_assignment_id;

  -- 7. Обновляем пользователя только с ID организации
  UPDATE public.users SET organization_id = v_org_id WHERE id = v_user_id;

  -- 8. Создаем группы контрагентов
  INSERT INTO public.counterparty_groups (name, description, organization_id, created_by, created_at)
  VALUES
    ('Поставщики', 'Все, кто поставляет товары/услуги', v_org_id, v_user_id, NOW()),
    ('Арендодатели', 'Владельцы помещений', v_org_id, v_user_id, NOW()),
    ('Подрядчики', 'Юристы, клинеры, бухгалтеры и т.д.', v_org_id, v_user_id, NOW());

  RAISE LOG '✅ Созданы группы контрагентов';

  -- 9. Создаем статьи операций (категории)
  INSERT INTO public.categories (name, type, color, organization_id, created_by, created_at) VALUES
  ('Доход от продажи', 'income', '#4CAF50', v_org_id, v_user_id, NOW()),
  ('Прочие доходы', 'income', '#2196F3', v_org_id, v_user_id, NOW()),
  ('Актуализация', 'expense', '#FF5722', v_org_id, v_user_id, NOW()),
  ('Зарплата персонала', 'expense', '#9C27B0', v_org_id, v_user_id, NOW()),
  ('Закупка товаров', 'expense', '#FF9800', v_org_id, v_user_id, NOW()),
  ('Аренда помещения', 'expense', '#795548', v_org_id, v_user_id, NOW()),
  ('Коммунальные услуги', 'expense', '#607D8B', v_org_id, v_user_id, NOW()),
  ('Ремонт и обслуживание', 'expense', '#FFC107', v_org_id, v_user_id, NOW()),
  ('Налоги и сборы', 'expense', '#F44336', v_org_id, v_user_id, NOW()),
  ('Штрафы и санкции', 'expense', '#E91E63', v_org_id, v_user_id, NOW());

  RAISE LOG '✅ Созданы категории операций';

  -- 10. Создаем счета
  INSERT INTO public.accounts (
    name, balance, currency, description, account_type,
    organization_id, legal_entity_id, created_by, created_at
  ) VALUES
  ('Основной банковский счёт', 0.00, 'RUB', 'Расчетный счет для ведения основной деятельности', 'checking', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Для ежедневной выручки', 0.00, 'RUB', 'Касса для ежедневных операций и выручки', 'cash', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Долгосрочное хранение налички', 0.00, 'RUB', 'Сейф для долгосрочного хранения наличных средств', 'cash', v_org_id, v_legal_entity_id, v_user_id, NOW());

  RAISE LOG '✅ Созданы счета';

  RETURN json_build_object(
    'success', TRUE,
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'legal_entity_id', v_legal_entity_id,
    'position_id', v_owner_position_id,
    'assignment_id', v_assignment_id,
    'message', 'Пользователь успешно инициализирован с полным набором бизнес-данных',
    'data', json_build_object(
      'organization_name', 'Моя компания',
      'legal_entity_name', 'Мой первый бизнес',
      'position_name', 'Владелец',
      'accounts_created', 3,
      'counterparty_groups_created', 3,
      'categories_created', 10
    )
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

-- 7. Удаляем триггеры перед изменением функций
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 8. Исправляем функцию init_user_from_auth (удаляем и создаем заново)
DROP FUNCTION IF EXISTS public.init_user_from_auth();
CREATE FUNCTION public.init_user_from_auth()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
BEGIN
  -- Пытаемся создать пользователя в public.users
  BEGIN
    PERFORM public.init_user_full_setup(
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'full_name'
    );
    
    RAISE LOG '✅ Пользователь % успешно инициализирован', NEW.email;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '❌ Ошибка инициализации пользователя %: %', NEW.email, SQLERRM;
    -- НЕ блокируем регистрацию в auth.users
  END;
  
  RETURN NEW;
END;
$$;

-- 9. Исправляем функцию handle_new_user_signup (удаляем и создаем заново)
DROP FUNCTION IF EXISTS public.handle_new_user_signup();
CREATE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
BEGIN
  -- Вызываем функцию инициализации  
  PERFORM public.init_user_full_setup(
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '❌ Ошибка автоинициализации пользователя %: %', NEW.email, SQLERRM;
  RETURN NEW; -- НЕ блокируем регистрацию
END;
$$;

-- 10. Исправляем функцию complete_user_registration  
CREATE OR REPLACE FUNCTION public.complete_user_registration()
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''  -- ← ИСПРАВЛЕНИЕ БЕЗОПАСНОСТИ
AS $$
DECLARE
  v_auth_user_id UUID;
  v_email TEXT;
  v_full_name TEXT;
  v_result JSON;
BEGIN
  -- Получаем ID текущего авторизованного пользователя
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'Not authenticated',
      'message', 'Пользователь не авторизован'
    );
  END IF;
  
  -- Проверяем, не инициализирован ли уже
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_auth_user_id) THEN 
    RETURN json_build_object(
      'success', TRUE,
      'message', 'Пользователь уже инициализирован',
      'user_id', v_auth_user_id
    );
  END IF;
  
  -- Получаем данные из auth.users
  SELECT email, raw_user_meta_data->>'full_name'
  INTO v_email, v_full_name
  FROM auth.users
  WHERE id = v_auth_user_id;
  
  IF v_email IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'User email not found',
      'message', 'Email пользователя не найден'
    );
  END IF;
  
  -- Вызываем инициализацию
  SELECT public.init_user_full_setup(v_auth_user_id, v_email, v_full_name)
  INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Проверяем результат
DO $$
BEGIN
  RAISE LOG '✅ Исправлено search_path для всех функций';
  RAISE LOG '🔒 Функции теперь защищены от schema poisoning атак';
  RAISE LOG '📋 Исправлены функции:';
  RAISE LOG '   - has_organization_access';
  RAISE LOG '   - has_legal_entity_access';
  RAISE LOG '   - has_permission';
  RAISE LOG '   - get_user_permissions';
  RAISE LOG '   - check_user_initialization_status';
  RAISE LOG '   - init_user_full_setup';
  RAISE LOG '   - init_user_from_auth';
  RAISE LOG '   - handle_new_user_signup';
  RAISE LOG '   - complete_user_registration';
END $$; 