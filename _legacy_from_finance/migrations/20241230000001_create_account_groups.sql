-- Создание таблицы групп счетов

-- Создаем таблицу групп счетов
CREATE TABLE IF NOT EXISTS account_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- Обновляем таблицу счетов, добавляя поле group_name (только если не существует)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='group_name') THEN
        ALTER TABLE accounts ADD COLUMN group_name TEXT;
    END IF;
END $$;

-- Обновляем audit_logs для поддержки account_group (только если ограничение еще не обновлено)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'audit_logs_entity_type_check' 
        AND check_clause LIKE '%account_group%'
    ) THEN
        ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_entity_type_check;
        ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check 
          CHECK (entity_type IN ('account', 'category', 'transaction', 'user', 'counterparty', 'account_group'));
    END IF;
END $$;

-- Создаем индекс для оптимизации (только если не существует)
CREATE INDEX IF NOT EXISTS idx_account_groups_name ON account_groups(name);

-- Добавляем мок-данные для групп счетов (только если таблица пустая)
INSERT INTO account_groups (id, name, created_by, created_at) 
SELECT '550e8400-e29b-41d4-a716-446655440100', 'Операционные счета', '550e8400-e29b-41d4-a716-446655440001', NOW()
WHERE NOT EXISTS (SELECT 1 FROM account_groups WHERE name = 'Операционные счета');

INSERT INTO account_groups (id, name, created_by, created_at) 
SELECT '550e8400-e29b-41d4-a716-446655440101', 'Накопительные счета', '550e8400-e29b-41d4-a716-446655440001', NOW()
WHERE NOT EXISTS (SELECT 1 FROM account_groups WHERE name = 'Накопительные счета');

INSERT INTO account_groups (id, name, created_by, created_at) 
SELECT '550e8400-e29b-41d4-a716-446655440102', 'Инвестиционные счета', '550e8400-e29b-41d4-a716-446655440001', NOW()
WHERE NOT EXISTS (SELECT 1 FROM account_groups WHERE name = 'Инвестиционные счета');

INSERT INTO account_groups (id, name, created_by, created_at) 
SELECT '550e8400-e29b-41d4-a716-446655440103', 'Валютные счета', '550e8400-e29b-41d4-a716-446655440001', NOW()
WHERE NOT EXISTS (SELECT 1 FROM account_groups WHERE name = 'Валютные счета');

-- Настройки безопасности RLS (отключаем для разработки)
ALTER TABLE account_groups DISABLE ROW LEVEL SECURITY; 