-- Создание многотенантной структуры для финансового трекера
-- Миграция от 31.12.2024

-- 1. Создаем таблицу организаций (головная сущность)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}', -- настройки организации
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 2. Создаем таблицу юридических лиц (заведения)
CREATE TABLE IF NOT EXISTS legal_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_form TEXT NOT NULL DEFAULT 'ИП', -- ИП, ООО, АО и т.д.
  inn TEXT,
  ogrn TEXT,
  kpp TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE, -- основное юрлицо организации
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 3. Создаем таблицу должностей
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- Директор, Бухгалтер, Управляющий, Бармен и т.д.
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}', -- права доступа к функциям системы
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. Создаем таблицу назначений пользователей на должности
CREATE TABLE IF NOT EXISTS user_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE CASCADE,
  position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
  role_type TEXT NOT NULL DEFAULT 'employee', -- owner, admin, employee
  permissions JSONB NOT NULL DEFAULT '{}', -- индивидуальные права (переопределяют должностные)
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ, -- когда пользователь принял приглашение
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 5. Добавляем organization_id к пользователям (основная организация)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- 6. Добавляем organization_id к существующим таблицам для изоляции данных
ALTER TABLE accounts 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE CASCADE;

ALTER TABLE categories 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE counterparties 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE CASCADE;

-- Добавляем organization_id к группам
ALTER TABLE account_groups 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE category_groups 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE counterparty_groups 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 7. Создаем индексы для производительности
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_legal_entities_organization_id ON legal_entities(organization_id);
CREATE INDEX IF NOT EXISTS idx_positions_organization_id ON positions(organization_id);
CREATE INDEX IF NOT EXISTS idx_positions_legal_entity_id ON positions(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_user_assignments_user_id ON user_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_assignments_organization_id ON user_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_assignments_legal_entity_id ON user_assignments(legal_entity_id);

-- Обновляем индексы для изоляции данных
CREATE INDEX IF NOT EXISTS idx_accounts_organization_id ON accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_accounts_legal_entity_id ON accounts(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_categories_organization_id ON categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_organization_id ON counterparties(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_organization_id ON transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_legal_entity_id ON transactions(legal_entity_id);

-- 8. Создаем уникальные ограничения
-- Только одно основное юрлицо на организацию
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_entities_organization_default 
ON legal_entities(organization_id) 
WHERE is_default = TRUE;

-- 9. Создаем тестовые данные для демонстрации
-- Организация по умолчанию
INSERT INTO organizations (id, name, description, owner_id, created_at) VALUES
('550e8400-e29b-41d4-a716-446655440100', 'Моя организация', 'Основная организация пользователя', '550e8400-e29b-41d4-a716-446655440001', NOW())
ON CONFLICT (id) DO NOTHING;

-- Обновляем пользователя - назначаем его в организацию
UPDATE users 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100'
WHERE id = '550e8400-e29b-41d4-a716-446655440001';

-- Создаем основное юридическое лицо
INSERT INTO legal_entities (id, organization_id, name, legal_form, inn, is_default, created_at) VALUES
('550e8400-e29b-41d4-a716-446655440101', '550e8400-e29b-41d4-a716-446655440100', 'ИП Иванов И.И.', 'ИП', '123456789012', TRUE, NOW()),
('550e8400-e29b-41d4-a716-446655440102', '550e8400-e29b-41d4-a716-446655440100', 'ООО "Рога и копыта"', 'ООО', '1234567890', FALSE, NOW())
ON CONFLICT (id) DO NOTHING;

-- Создаем должности
INSERT INTO positions (id, organization_id, legal_entity_id, name, description, permissions, created_at) VALUES
('550e8400-e29b-41d4-a716-446655440201', '550e8400-e29b-41d4-a716-446655440100', NULL, 'Владелец', 'Полные права доступа ко всем функциям', '{"all": true}', NOW()),
('550e8400-e29b-41d4-a716-446655440202', '550e8400-e29b-41d4-a716-446655440100', '550e8400-e29b-41d4-a716-446655440101', 'Директор', 'Управление заведением', '{"manage_legal_entity": true, "view_reports": true}', NOW()),
('550e8400-e29b-41d4-a716-446655440203', '550e8400-e29b-41d4-a716-446655440100', '550e8400-e29b-41d4-a716-446655440101', 'Бухгалтер', 'Ведение финансового учета', '{"manage_transactions": true, "view_reports": true}', NOW())
ON CONFLICT (id) DO NOTHING;

-- Назначаем пользователя владельцем организации
INSERT INTO user_assignments (id, user_id, organization_id, role_type, permissions, accepted_at, invited_at) VALUES
('550e8400-e29b-41d4-a716-446655440301', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440100', 'owner', '{"all": true}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 10. Обновляем существующие данные - привязываем к организации
UPDATE accounts 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100',
    legal_entity_id = '550e8400-e29b-41d4-a716-446655440101'
WHERE organization_id IS NULL;

UPDATE categories 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100'
WHERE organization_id IS NULL;

UPDATE counterparties 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100'
WHERE organization_id IS NULL;

UPDATE transactions 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100',
    legal_entity_id = '550e8400-e29b-41d4-a716-446655440101'
WHERE organization_id IS NULL;

UPDATE account_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100'
WHERE organization_id IS NULL;

UPDATE category_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100'
WHERE organization_id IS NULL;

UPDATE counterparty_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440100'
WHERE organization_id IS NULL;

-- 11. Настройки RLS (пока отключаем для разработки)
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE positions DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_assignments DISABLE ROW LEVEL SECURITY; 