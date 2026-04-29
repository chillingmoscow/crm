-- Исправление функции инициализации пользователя
-- Убираем ссылку на удаленное поле role

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

  RAISE LOG '🚀 Начинаем инициализацию пользователя: %', p_email;

  -- Устанавливаем полное имя
  v_full_name := COALESCE(p_full_name, 'Новый пользователь');

  -- 1. Создаем пользователя (БЕЗ ПОЛЯ ROLE!)
  INSERT INTO public.users (id, full_name, email, created_at, is_active)
  VALUES (p_auth_user_id, v_full_name, p_email, NOW(), TRUE)
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

COMMENT ON FUNCTION public.init_user_full_setup IS 'ИСПРАВЛЕННАЯ функция инициализации пользователя - убрано поле role'; 