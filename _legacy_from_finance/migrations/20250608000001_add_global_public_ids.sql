-- 📋 ДОБАВЛЕНИЕ ГЛОБАЛЬНЫХ PUBLIC_ID ДЛЯ API
-- Добавляет поле public_id SERIAL во все основные таблицы для удобного API

-- 🏢 ORGANIZATIONS
ALTER TABLE organizations ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_organizations_public_id ON organizations(public_id);
COMMENT ON COLUMN organizations.public_id IS 'Глобальный автоинкрементный ID для API';

-- 🏭 LEGAL_ENTITIES  
ALTER TABLE legal_entities ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_legal_entities_public_id ON legal_entities(public_id);
COMMENT ON COLUMN legal_entities.public_id IS 'Глобальный автоинкрементный ID для API';

-- 👤 POSITIONS
ALTER TABLE positions ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_positions_public_id ON positions(public_id);
COMMENT ON COLUMN positions.public_id IS 'Глобальный автоинкрементный ID для API';

-- 👥 USER_ASSIGNMENTS
ALTER TABLE user_assignments ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_user_assignments_public_id ON user_assignments(public_id);
COMMENT ON COLUMN user_assignments.public_id IS 'Глобальный автоинкрементный ID для API';

-- 👨‍💼 EMPLOYEES
ALTER TABLE employees ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_employees_public_id ON employees(public_id);
COMMENT ON COLUMN employees.public_id IS 'Глобальный автоинкрементный ID для API';

-- 💰 ACCOUNTS
ALTER TABLE accounts ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_accounts_public_id ON accounts(public_id);
COMMENT ON COLUMN accounts.public_id IS 'Глобальный автоинкрементный ID для API';

-- 📦 ACCOUNT_GROUPS
ALTER TABLE account_groups ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_account_groups_public_id ON account_groups(public_id);
COMMENT ON COLUMN account_groups.public_id IS 'Глобальный автоинкрементный ID для API';

-- 📂 CATEGORIES
ALTER TABLE categories ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_categories_public_id ON categories(public_id);
COMMENT ON COLUMN categories.public_id IS 'Глобальный автоинкрементный ID для API';

-- 📦 CATEGORY_GROUPS
ALTER TABLE category_groups ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_category_groups_public_id ON category_groups(public_id);
COMMENT ON COLUMN category_groups.public_id IS 'Глобальный автоинкрементный ID для API';

-- 🤝 COUNTERPARTIES
ALTER TABLE counterparties ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_counterparties_public_id ON counterparties(public_id);
COMMENT ON COLUMN counterparties.public_id IS 'Глобальный автоинкрементный ID для API';

-- 📦 COUNTERPARTY_GROUPS
ALTER TABLE counterparty_groups ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_counterparty_groups_public_id ON counterparty_groups(public_id);
COMMENT ON COLUMN counterparty_groups.public_id IS 'Глобальный автоинкрементный ID для API';

-- 💸 TRANSACTIONS
ALTER TABLE transactions ADD COLUMN public_id SERIAL UNIQUE;
CREATE INDEX idx_transactions_public_id ON transactions(public_id);
COMMENT ON COLUMN transactions.public_id IS 'Глобальный автоинкрементный ID для API';

-- 📄 ATTACHED_FILES (если таблица существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attached_files') THEN
    ALTER TABLE attached_files ADD COLUMN public_id SERIAL UNIQUE;
    CREATE INDEX idx_attached_files_public_id ON attached_files(public_id);
    COMMENT ON COLUMN attached_files.public_id IS 'Глобальный автоинкрементный ID для API';
  END IF;
END $$;

-- 🔗 TRANSACTION_ATTACHMENTS (если таблица существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transaction_attachments') THEN
    ALTER TABLE transaction_attachments ADD COLUMN public_id SERIAL UNIQUE;
    CREATE INDEX idx_transaction_attachments_public_id ON transaction_attachments(public_id);
    COMMENT ON COLUMN transaction_attachments.public_id IS 'Глобальный автоинкрементный ID для API';
  END IF;
END $$;

-- 🔍 POSITION_PERMISSIONS (если таблица существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'position_permissions') THEN
    ALTER TABLE position_permissions ADD COLUMN public_id SERIAL UNIQUE;
    CREATE INDEX idx_position_permissions_public_id ON position_permissions(public_id);
    COMMENT ON COLUMN position_permissions.public_id IS 'Глобальный автоинкрементный ID для API';
  END IF;
END $$;

-- 📊 AUDIT_LOGS (если таблица существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    ALTER TABLE audit_logs ADD COLUMN public_id SERIAL UNIQUE;
    CREATE INDEX idx_audit_logs_public_id ON audit_logs(public_id);
    COMMENT ON COLUMN audit_logs.public_id IS 'Глобальный автоинкрементный ID для API';
  END IF;
END $$;

-- ✅ ИТОГОВЫЙ ЛОГ
DO $$
BEGIN
  RAISE LOG '✅ Добавлены public_id поля во все таблицы';
  RAISE LOG '🔢 SERIAL автоматически создает sequences для каждой таблицы';
  RAISE LOG '🚀 API теперь может использовать короткие ID вместо UUID';
  RAISE LOG '🔐 RLS политики обеспечивают безопасность доступа';
END $$; 