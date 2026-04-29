-- Исправление связей между сущностями и группами

-- 1. Создаем таблицы для групп категорий и контрагентов
CREATE TABLE IF NOT EXISTS category_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'both')),
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS counterparty_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- 2. Добавляем поле group_id в таблицу accounts (вместо group_name)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='group_id') THEN
        ALTER TABLE accounts ADD COLUMN group_id UUID REFERENCES account_groups(id);
    END IF;
END $$;

-- 3. Добавляем поле group_id в таблицу categories
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='group_id') THEN
        ALTER TABLE categories ADD COLUMN group_id UUID REFERENCES category_groups(id);
    END IF;
END $$;

-- 4. Добавляем поле group_id в таблицу counterparties
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='counterparties' AND column_name='group_id') THEN
        ALTER TABLE counterparties ADD COLUMN group_id UUID REFERENCES counterparty_groups(id);
    END IF;
END $$;

-- 5. Обновляем audit_logs для поддержки новых типов групп
DO $$
BEGIN
    ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check 
      CHECK (entity_type IN ('account', 'category', 'transaction', 'user', 'counterparty', 'account_group', 'category_group', 'counterparty_group'));
END $$;

-- 6. Добавляем мок-данные для групп категорий
INSERT INTO category_groups (id, name, type, description, created_by, created_at) 
VALUES
  ('550e8400-e29b-41d4-a716-446655440200', 'Основные расходы', 'expense', 'Ежемесячные обязательные расходы на ведение бизнеса', '550e8400-e29b-41d4-a716-446655440001', NOW()),
  ('550e8400-e29b-41d4-a716-446655440201', 'Доходы от продаж', 'income', 'Все виды доходов от продаж товаров и услуг', '550e8400-e29b-41d4-a716-446655440001', NOW()),
  ('550e8400-e29b-41d4-a716-446655440202', 'Маркетинг и реклама', 'expense', 'Расходы на продвижение и рекламу', '550e8400-e29b-41d4-a716-446655440001', NOW()),
  ('550e8400-e29b-41d4-a716-446655440203', 'Универсальные операции', 'both', 'Категории для операций любого типа', '550e8400-e29b-41d4-a716-446655440001', NOW())
ON CONFLICT (id) DO NOTHING;

-- 7. Добавляем мок-данные для групп контрагентов
INSERT INTO counterparty_groups (id, name, description, created_by, created_at)
VALUES
  ('550e8400-e29b-41d4-a716-446655440300', 'Основные поставщики', 'Постоянные поставщики товаров и материалов', '550e8400-e29b-41d4-a716-446655440001', NOW()),
  ('550e8400-e29b-41d4-a716-446655440301', 'Клиенты', 'Основные клиенты и заказчики компании', '550e8400-e29b-41d4-a716-446655440001', NOW()),
  ('550e8400-e29b-41d4-a716-446655440302', 'Банки и финансовые организации', 'Банки, страховые компании, инвестиционные фонды', '550e8400-e29b-41d4-a716-446655440001', NOW()),
  ('550e8400-e29b-41d4-a716-446655440303', 'Государственные органы', 'Налоговая, пенсионный фонд, соцстрах', '550e8400-e29b-41d4-a716-446655440001', NOW())
ON CONFLICT (id) DO NOTHING;

-- 8. Создаем индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_category_groups_name ON category_groups(name);
CREATE INDEX IF NOT EXISTS idx_category_groups_type ON category_groups(type);
CREATE INDEX IF NOT EXISTS idx_counterparty_groups_name ON counterparty_groups(name);
CREATE INDEX IF NOT EXISTS idx_accounts_group_id ON accounts(group_id);
CREATE INDEX IF NOT EXISTS idx_categories_group_id ON categories(group_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_group_id ON counterparties(group_id);

-- 9. Настройки безопасности RLS (отключаем для разработки)
ALTER TABLE category_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE counterparty_groups DISABLE ROW LEVEL SECURITY; 