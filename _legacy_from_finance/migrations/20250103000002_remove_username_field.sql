-- Удаление поля username из системы
-- Миграция от 03.01.2025

-- 1. Удаляем поле username из таблицы users
ALTER TABLE public.users DROP COLUMN IF EXISTS username CASCADE;

-- 2. Удаляем старую функцию и создаем новую
DROP FUNCTION IF EXISTS public.init_user_full_setup(UUID, TEXT, TEXT, TEXT);

-- 3. Обновляем функцию инициализации пользователя без username
CREATE OR REPLACE FUNCTION public.init_user_full_setup(
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

  -- Логирование начала процесса
  RAISE LOG 'Начинаем инициализацию пользователя для email: %', p_email;
  
  -- Устанавливаем полное имя по умолчанию если не передано
  IF p_full_name IS NULL THEN
    v_full_name := 'Новый пользователь';
  ELSE
    v_full_name := p_full_name;
  END IF;
  
  -- 1. Создаем запись в public.users (БЕЗ username)
  INSERT INTO public.users (
    id,
    full_name,
    email,
    role,
    created_at,
    is_active
  ) VALUES (
    p_auth_user_id,
    v_full_name,
    p_email,
    'user',
    NOW(),
    TRUE
  ) RETURNING id INTO v_user_id;
  
  RAISE LOG 'Создан пользователь с ID: %', v_user_id;
  
  -- 2. Создаем организацию (личный кабинет)
  INSERT INTO public.organizations (
    name,
    description,
    is_active,
    created_at
  ) VALUES (
    'Личный кабинет - ' || v_full_name,
    'Автоматически созданная персональная организация',
    TRUE,
    NOW()
  ) RETURNING id INTO v_org_id;
  
  RAISE LOG 'Создана организация с ID: %', v_org_id;
  
  -- 3. Создаем юридическое лицо
  INSERT INTO public.legal_entities (
    name,
    legal_form,
    registration_address,
    postal_address,
    organization_id,
    created_at,
    is_active
  ) VALUES (
    v_full_name || ' (ИП)',
    'individual',
    'Не указан',
    'Не указан', 
    v_org_id,
    NOW(),
    TRUE
  ) RETURNING id INTO v_legal_entity_id;
  
  RAISE LOG 'Создано юридическое лицо с ID: %', v_legal_entity_id;
  
  -- 4. Создаем должность "Владелец"
  INSERT INTO public.positions (
    title,
    description,
    organization_id,
    created_at,
    is_active
  ) VALUES (
    'Владелец',
    'Владелец организации',
    v_org_id,
    NOW(),
    TRUE
  ) RETURNING id INTO v_owner_position_id;
  
  RAISE LOG 'Создана должность владельца с ID: %', v_owner_position_id;
  
  -- 5. Создаем назначение пользователя
  INSERT INTO public.user_assignments (
    user_id,
    organization_id,
    legal_entity_id,
    position_id,
    role_type,
    permissions,
    invited_at,
    accepted_at,
    is_active
  ) VALUES (
    v_user_id,
    v_org_id,
    v_legal_entity_id,
    v_owner_position_id,
    'owner',
    '{"all": true}'::jsonb,
    NOW(),
    NOW(),
    TRUE
  ) RETURNING id INTO v_assignment_id;
  
  RAISE LOG 'Создано назначение с ID: %', v_assignment_id;
  
  -- 6. Обновляем пользователя с ID организации
  UPDATE public.users 
  SET organization_id = v_org_id
  WHERE id = v_user_id;
  
  -- 7. Создаем базовые категории доходов
  INSERT INTO public.categories (name, type, color, organization_id, legal_entity_id, created_by, created_at) VALUES
  ('Зарплата', 'income', '#4CAF50', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Продажи', 'income', '#2196F3', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Прочие доходы', 'income', '#FF9800', v_org_id, v_legal_entity_id, v_user_id, NOW());
  
  -- 8. Создаем базовые категории расходов  
  INSERT INTO public.categories (name, type, color, organization_id, legal_entity_id, created_by, created_at) VALUES
  ('Офисные расходы', 'expense', '#F44336', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Транспорт', 'expense', '#9C27B0', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Питание', 'expense', '#795548', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Прочие расходы', 'expense', '#607D8B', v_org_id, v_legal_entity_id, v_user_id, NOW());
  
  RAISE LOG 'Созданы базовые категории';
  
  -- 9. Создаем стартовый счет
  INSERT INTO public.accounts (
    name,
    balance,
    currency,
    description,
    account_type,
    organization_id,
    legal_entity_id,
    created_by,
    created_at
  ) VALUES (
    'Основной счет',
    0.00,
    'RUB',
    'Основной расчетный счет',
    'checking',
    v_org_id,
    v_legal_entity_id,
    v_user_id,
    NOW()
  );
  
  RAISE LOG 'Создан стартовый счет для пользователя';
  
  -- 10. Формируем результат
  v_result := json_build_object(
    'success', TRUE,
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'legal_entity_id', v_legal_entity_id,
    'position_id', v_owner_position_id,
    'assignment_id', v_assignment_id,
    'message', 'Пользователь успешно инициализирован'
  );
  
  RAISE LOG 'Инициализация пользователя завершена успешно';
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  -- В случае ошибки логируем и возвращаем информацию об ошибке
  RAISE LOG 'Ошибка при инициализации пользователя: %', SQLERRM;
  
  RETURN json_build_object(
    'success', FALSE,
    'error', SQLERRM,
    'message', 'Ошибка при инициализации пользователя'
  );
END;
$$;

-- 4. Обновляем функцию обновления тестовых данных (удаляем username)
UPDATE public.users SET full_name = 'Тестовый пользователь' WHERE email = 'admin@admin.ru';

-- Комментарии
COMMENT ON FUNCTION public.init_user_full_setup IS 'Полная инициализация нового пользователя БЕЗ поля username'; 