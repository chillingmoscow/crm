-- Функция автоматической инициализации пользователя при регистрации
-- Миграция от 02.01.2025

-- Функция для инициализации нового пользователя с организацией и юридическим лицом
CREATE OR REPLACE FUNCTION public.init_user_full_setup(
  p_auth_user_id UUID,
  p_email TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER -- Выполняется с правами создателя функции
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_legal_entity_id UUID;
  v_owner_position_id UUID;
  v_assignment_id UUID;
  v_username TEXT;
  v_full_name TEXT;
  v_result JSON;
BEGIN
  -- Логирование начала процесса
  RAISE LOG 'Начинаем инициализацию пользователя для email: %', p_email;
  
  -- Генерируем username из email если не передан
  IF p_username IS NULL THEN
    v_username := split_part(p_email, '@', 1);
  ELSE
    v_username := p_username;
  END IF;
  
  -- Устанавливаем полное имя по умолчанию если не передано
  IF p_full_name IS NULL THEN
    v_full_name := 'Новый пользователь';
  ELSE
    v_full_name := p_full_name;
  END IF;
  
  -- 1. Создаем запись в public.users
  INSERT INTO public.users (
    id,
    username,
    full_name,
    email,
    role,
    created_at,
    is_active
  ) VALUES (
    p_auth_user_id, -- Используем ID из auth.users
    v_username,
    v_full_name,
    p_email,
    'user', -- По умолчанию обычный пользователь
    NOW(),
    TRUE
  ) RETURNING id INTO v_user_id;
  
  RAISE LOG 'Создан пользователь с ID: %', v_user_id;
  
  -- 2. Создаем организацию (личный кабинет)
  INSERT INTO public.organizations (
    name,
    description,
    owner_id,
    settings,
    created_at,
    is_active
  ) VALUES (
    'Мой личный кабинет',
    'Персональная организация для управления финансами',
    v_user_id,
    '{"currency": "RUB", "timezone": "Europe/Moscow", "auto_backup": false}'::JSONB,
    NOW(),
    TRUE
  ) RETURNING id INTO v_org_id;
  
  RAISE LOG 'Создана организация с ID: %', v_org_id;
  
  -- 3. Обновляем пользователя - привязываем к организации
  UPDATE public.users 
  SET organization_id = v_org_id
  WHERE id = v_user_id;
  
  -- 4. Создаем первое юридическое лицо (по умолчанию)
  INSERT INTO public.legal_entities (
    organization_id,
    name,
    legal_form,
    description,
    is_default,
    created_at,
    is_active
  ) VALUES (
    v_org_id,
    'Мое первое заведение',
    'ИП',
    'Основное юридическое лицо для ведения деятельности',
    TRUE, -- Делаем это юрлицо основным
    NOW(),
    TRUE
  ) RETURNING id INTO v_legal_entity_id;
  
  RAISE LOG 'Создано юридическое лицо с ID: %', v_legal_entity_id;
  
  -- 5. Создаем должность "Владелец" для данной организации
  INSERT INTO public.positions (
    organization_id,
    legal_entity_id,
    name,
    description,
    permissions,
    created_at,
    is_active
  ) VALUES (
    v_org_id,
    NULL, -- Владелец не привязан к конкретному юрлицу
    'Владелец',
    'Полные права доступа ко всем функциям организации',
    '{"all": true, "manage_organization": true, "manage_users": true, "manage_legal_entities": true}'::JSONB,
    NOW(),
    TRUE
  ) RETURNING id INTO v_owner_position_id;
  
  RAISE LOG 'Создана должность владельца с ID: %', v_owner_position_id;
  
  -- 6. Назначаем пользователя владельцем организации
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
    '{"all": true}'::JSONB,
    NOW(),
    NOW(), -- Автоматически принимаем назначение
    TRUE
  ) RETURNING id INTO v_assignment_id;
  
  RAISE LOG 'Создано назначение пользователя с ID: %', v_assignment_id;
  
  -- 7. Создаем базовые группы для нового пользователя
  -- Группы счетов
  INSERT INTO public.account_groups (name, organization_id, created_by, created_at)
  VALUES 
    ('Основные счета', v_org_id, v_user_id, NOW()),
    ('Банковские карты', v_org_id, v_user_id, NOW()),
    ('Наличные', v_org_id, v_user_id, NOW());
  
  -- Группы категорий доходов
  INSERT INTO public.category_groups (name, type, description, organization_id, created_by, created_at)
  VALUES 
    ('Основные доходы', 'income', 'Основные источники доходов', v_org_id, v_user_id, NOW()),
    ('Дополнительные доходы', 'income', 'Прочие поступления', v_org_id, v_user_id, NOW());
  
  -- Группы категорий расходов
  INSERT INTO public.category_groups (name, type, description, organization_id, created_by, created_at)
  VALUES 
    ('Повседневные расходы', 'expense', 'Ежедневные траты', v_org_id, v_user_id, NOW()),
    ('Бизнес расходы', 'expense', 'Расходы на ведение деятельности', v_org_id, v_user_id, NOW());
  
  -- Группы контрагентов
  INSERT INTO public.counterparty_groups (name, description, organization_id, created_by, created_at)
  VALUES 
    ('Поставщики', 'Основные поставщики товаров и услуг', v_org_id, v_user_id, NOW()),
    ('Клиенты', 'Постоянные клиенты', v_org_id, v_user_id, NOW());
  
  RAISE LOG 'Созданы базовые группы для пользователя';
  
  -- 8. Создаем базовые категории
  INSERT INTO public.categories (name, type, description, color, organization_id, created_by, created_at)
  VALUES 
    ('Продажи', 'income', 'Доходы от основной деятельности', '#4CAF50', v_org_id, v_user_id, NOW()),
    ('Прочие доходы', 'income', 'Дополнительные поступления', '#8BC34A', v_org_id, v_user_id, NOW()),
    ('Закупки', 'expense', 'Покупка товаров и материалов', '#F44336', v_org_id, v_user_id, NOW()),
    ('Аренда', 'expense', 'Арендные платежи', '#FF9800', v_org_id, v_user_id, NOW()),
    ('Реклама', 'expense', 'Маркетинг и реклама', '#9C27B0', v_org_id, v_user_id, NOW());
  
  RAISE LOG 'Созданы базовые категории для пользователя';
  
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

-- Создаем упрощенную функцию для вызова из Edge Function
CREATE OR REPLACE FUNCTION public.init_user_from_auth()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id UUID;
  v_email TEXT;
  v_full_name TEXT;
  v_result JSON;
BEGIN
  -- Получаем ID текущего пользователя из auth
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'No authenticated user found',
      'message', 'Пользователь не аутентифицирован'
    );
  END IF;
  
  -- Получаем email из auth.users
  SELECT email, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', 'Новый пользователь')
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
  
  -- Проверяем, не создан ли уже пользователь
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_auth_user_id) THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'User already exists',
      'message', 'Пользователь уже инициализирован',
      'user_id', v_auth_user_id
    );
  END IF;
  
  -- Вызываем основную функцию инициализации
  SELECT public.init_user_full_setup(v_auth_user_id, v_email, v_full_name, NULL)
  INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Комментарии для документации
COMMENT ON FUNCTION public.init_user_full_setup IS 'Полная инициализация нового пользователя с созданием организации, юридического лица и базовых данных';
COMMENT ON FUNCTION public.init_user_from_auth IS 'Упрощенная функция инициализации пользователя из auth контекста для Edge Functions'; 