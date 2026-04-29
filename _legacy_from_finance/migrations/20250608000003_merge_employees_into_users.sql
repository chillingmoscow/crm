-- 🚧 ОБЪЕДИНЕНИЕ ТАБЛИЦ USERS И EMPLOYEES
-- Миграция от 08.06.2025 - Устранение дублирования данных
-- Добавляет поля из employees в users и удаляет избыточную таблицу employees

-- 1. ДОБАВЛЯЕМ НЕДОСТАЮЩИЕ ПОЛЯ В ТАБЛИЦУ USERS
-- Личные данные
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10) CHECK (gender IN ('male', 'female'));

-- Контактная информация
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(100);

-- Статус и даты
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'terminated'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS termination_date DATE;

-- Связи с организационной структурой
ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE SET NULL;

-- Дополнительные поля
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- 2. СОЗДАЕМ ФУНКЦИЮ ДЛЯ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ full_name
CREATE OR REPLACE FUNCTION public.update_user_full_name()
RETURNS TRIGGER AS $$
BEGIN
    NEW.full_name := CASE 
        WHEN NEW.middle_name IS NOT NULL AND NEW.middle_name != '' 
        THEN COALESCE(NEW.last_name, '') || ' ' || COALESCE(NEW.first_name, '') || ' ' || NEW.middle_name
        ELSE COALESCE(NEW.last_name, '') || ' ' || COALESCE(NEW.first_name, '')
    END;
    
    -- Убираем лишние пробелы в начале и конце
    NEW.full_name := TRIM(NEW.full_name);
    
    -- Если полное имя пустое, оставляем email как fallback
    IF NEW.full_name = '' OR NEW.full_name IS NULL THEN
        NEW.full_name := COALESCE(NEW.email, 'Пользователь');
    END IF;
    
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. СОЗДАЕМ ТРИГГЕР ДЛЯ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ full_name
DROP TRIGGER IF EXISTS trigger_update_user_full_name ON users;
CREATE TRIGGER trigger_update_user_full_name
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_user_full_name();

-- 4. СОЗДАЕМ ТРИГГЕР ДЛЯ ОБНОВЛЕНИЯ updated_at
CREATE OR REPLACE FUNCTION public.update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_users_updated_at ON users;
CREATE TRIGGER trigger_update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_users_updated_at();

-- 5. ПЕРЕНОСИМ ДАННЫЕ ИЗ EMPLOYEES В USERS
-- Обновляем существующих пользователей данными из employees
UPDATE users 
SET 
    last_name = e.last_name,
    first_name = e.first_name,
    middle_name = e.middle_name,
    gender = e.gender,
    phone = e.phone,
    telegram_id = e.telegram_id,
    status = e.status,
    birth_date = e.birth_date,
    hire_date = e.hire_date,
    termination_date = e.termination_date,
    position_id = e.position_id,
    legal_entity_id = e.legal_entity_id,
    notes = e.notes,
    created_by = e.created_by,
    updated_by = e.updated_by,
    -- Обновляем avatar если он есть в employees
    avatar = COALESCE(e.avatar_url, users.avatar)
FROM employees e
WHERE users.id = e.user_id AND e.user_id IS NOT NULL;

-- Создаем новых пользователей для записей employees без user_id (приглашенные)
INSERT INTO users (
    id,
    full_name,
    email,
    last_name,
    first_name,
    middle_name,
    gender,
    phone,
    telegram_id,
    status,
    birth_date,
    hire_date,
    termination_date,
    organization_id,
    position_id,
    legal_entity_id,
    avatar,
    notes,
    created_at,
    is_active,
    created_by,
    updated_by
)
SELECT 
    gen_random_uuid(), -- Генерируем новый UUID для пользователя
    e.full_name,
    e.email,
    e.last_name,
    e.first_name,
    e.middle_name,
    e.gender,
    e.phone,
    e.telegram_id,
    e.status,
    e.birth_date,
    e.hire_date,
    e.termination_date,
    e.organization_id,
    e.position_id,
    e.legal_entity_id,
    e.avatar_url,
    e.notes,
    e.created_at,
    CASE WHEN e.status = 'active' THEN TRUE ELSE FALSE END,
    e.created_by,
    e.updated_by
FROM employees e
WHERE e.user_id IS NULL;

-- 6. СОЗДАЕМ ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ
CREATE INDEX IF NOT EXISTS idx_users_last_name ON users(last_name);
CREATE INDEX IF NOT EXISTS idx_users_first_name ON users(first_name);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_position_id ON users(position_id);
CREATE INDEX IF NOT EXISTS idx_users_legal_entity_id ON users(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_users_hire_date ON users(hire_date);
CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);

-- 7. ДОБАВЛЯЕМ КОММЕНТАРИИ К КОЛОНКАМ
COMMENT ON COLUMN users.last_name IS 'Фамилия пользователя';
COMMENT ON COLUMN users.first_name IS 'Имя пользователя';
COMMENT ON COLUMN users.middle_name IS 'Отчество пользователя';
COMMENT ON COLUMN users.full_name IS 'Полное ФИО (автоматически формируется из фамилии, имени и отчества)';
COMMENT ON COLUMN users.gender IS 'Пол: male (мужской) или female (женский)';
COMMENT ON COLUMN users.phone IS 'Номер телефона';
COMMENT ON COLUMN users.telegram_id IS 'ID в Telegram';
COMMENT ON COLUMN users.status IS 'Статус пользователя: invited, active, suspended, terminated';
COMMENT ON COLUMN users.birth_date IS 'Дата рождения';
COMMENT ON COLUMN users.hire_date IS 'Дата трудоустройства';
COMMENT ON COLUMN users.termination_date IS 'Дата увольнения';
COMMENT ON COLUMN users.position_id IS 'ID должности пользователя';
COMMENT ON COLUMN users.legal_entity_id IS 'ID юридического лица, к которому привязан пользователь';
COMMENT ON COLUMN users.notes IS 'Дополнительные заметки о пользователе';

-- 8. ОБНОВЛЯЕМ ФУНКЦИЮ ИНИЦИАЛИЗАЦИИ ПОЛЬЗОВАТЕЛЯ
-- Убираем создание записи в employees, так как теперь всё в users
CREATE OR REPLACE FUNCTION public.init_user_full_setup(
  p_auth_user_id UUID,
  p_email TEXT,
  p_full_name TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  -- 1. Создаем пользователя с разбором ФИО
  INSERT INTO public.users (
    id, 
    full_name, 
    email, 
    last_name,
    first_name,
    status,
    hire_date,
    created_at, 
    is_active
  ) VALUES (
    p_auth_user_id, 
    v_full_name, 
    p_email,
    COALESCE(SPLIT_PART(v_full_name, ' ', 1), 'Фамилия'),
    COALESCE(SPLIT_PART(v_full_name, ' ', 2), 'Имя'),
    'active',
    NOW(),
    NOW(), 
    TRUE
  ) RETURNING id INTO v_user_id;

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

  -- 7. Обновляем пользователя с привязками к организационной структуре
  UPDATE public.users SET 
    organization_id = v_org_id,
    position_id = v_owner_position_id,
    legal_entity_id = v_legal_entity_id
  WHERE id = v_user_id;

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
  ('Аренда', 'expense', '#F44336', v_org_id, v_user_id, NOW()),
  ('Коммунальные услуги', 'expense', '#FF9800', v_org_id, v_user_id, NOW()),
  ('Зарплата', 'expense', '#9C27B0', v_org_id, v_user_id, NOW()),
  ('Закупка товара', 'expense', '#607D8B', v_org_id, v_user_id, NOW()),
  ('Реклама и маркетинг', 'expense', '#E91E63', v_org_id, v_user_id, NOW()),
  ('Канцелярские товары', 'expense', '#795548', v_org_id, v_user_id, NOW()),
  ('Транспортные расходы', 'expense', '#009688', v_org_id, v_user_id, NOW()),
  ('Прочие расходы', 'expense', '#757575', v_org_id, v_user_id, NOW());

  RAISE LOG '✅ Создано 10 категорий операций';

  -- 10. Создаем базовые счета
  INSERT INTO public.accounts (
    name, balance, currency, account_type, organization_id, legal_entity_id, 
    created_by, created_at
  ) VALUES
  ('Касса', 0, 'RUB', 'cash', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Расчетный счет', 0, 'RUB', 'checking', v_org_id, v_legal_entity_id, v_user_id, NOW()),
  ('Банковская карта', 0, 'RUB', 'debit_card', v_org_id, v_legal_entity_id, v_user_id, NOW());

  RAISE LOG '✅ Созданы базовые счета';

  -- Возвращаем результат
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

-- 9. УДАЛЯЕМ ТАБЛИЦУ EMPLOYEES И ВСЕ СВЯЗАННЫЕ ОБЪЕКТЫ
-- Сначала удаляем RLS политики
DROP POLICY IF EXISTS "employees_select_policy" ON employees;
DROP POLICY IF EXISTS "employees_insert_policy" ON employees;
DROP POLICY IF EXISTS "employees_update_policy" ON employees;
DROP POLICY IF EXISTS "employees_delete_policy" ON employees;

-- Удаляем триггеры
DROP TRIGGER IF EXISTS trigger_update_employees_updated_at ON employees;
DROP FUNCTION IF EXISTS update_employees_updated_at();

-- Удаляем таблицу employees
DROP TABLE IF EXISTS employees CASCADE;

-- 10. СОЗДАЕМ НОВУЮ ПОЛИТИКУ RLS ДЛЯ ПОЛЬЗОВАТЕЛЕЙ
-- Политика для чтения: доступ к пользователям своей организации
CREATE POLICY "users_can_view_organization_users" ON users
    FOR SELECT USING (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
        )
    );

-- Политика для создания: только для своей организации
CREATE POLICY "users_can_create_organization_users" ON users
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
        )
    );

-- Политика для обновления: только для своей организации
CREATE POLICY "users_can_update_organization_users" ON users
    FOR UPDATE USING (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
        )
    );

-- Политика для удаления: только для своей организации
CREATE POLICY "users_can_delete_organization_users" ON users
    FOR DELETE USING (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
              AND ua.is_active = TRUE
              AND ua.accepted_at IS NOT NULL
        )
    );

-- ✅ ИТОГОВЫЙ ЛОГ
DO $$
BEGIN
  RAISE LOG '✅ Таблица employees объединена с users';
  RAISE LOG '✅ Добавлены поля: last_name, first_name, middle_name, gender, phone, telegram_id, status, birth_date, hire_date, termination_date, position_id, legal_entity_id, notes';
  RAISE LOG '✅ Создан триггер для автоматического формирования full_name';
  RAISE LOG '✅ Перенесены все данные из employees в users';
  RAISE LOG '✅ Создана новая функция инициализации без таблицы employees';
  RAISE LOG '✅ Удалена избыточная таблица employees';
  RAISE LOG '✅ Настроены RLS политики для users';
  RAISE LOG '🚀 Теперь система работает только с таблицей users';
END $$; 