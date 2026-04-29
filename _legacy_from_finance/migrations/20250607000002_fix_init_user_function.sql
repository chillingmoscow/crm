-- Исправляем функцию инициализации пользователя
-- Убираем ссылки на несуществующие колонки legal_entity_id в categories и position_id в users

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