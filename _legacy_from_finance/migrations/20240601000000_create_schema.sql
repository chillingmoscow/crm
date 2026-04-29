-- Схема базы данных для финансового трекера в Supabase

-- Включаем расширение для UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Создаем таблицу пользователей
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
  avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Создаем таблицу аудита
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('account', 'category', 'transaction', 'user', 'counterparty')),
  entity_id UUID NOT NULL,
  details TEXT NOT NULL
);

-- Создаем таблицу счетов
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- Создаем таблицу категорий
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  description TEXT,
  color TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- Создаем таблицу контрагентов
CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  legal_entity TEXT NOT NULL,
  inn TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- Создаем таблицу вложенных файлов
CREATE TABLE attached_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID NOT NULL REFERENCES users(id)
);

-- Создаем таблицу транзакций
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  amount DECIMAL(15, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  account_id UUID NOT NULL REFERENCES accounts(id),
  category_id UUID REFERENCES categories(id),
  counterparty_id UUID REFERENCES counterparties(id),
  description TEXT,
  date TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  to_account_id UUID REFERENCES accounts(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- Создаем промежуточную таблицу для связи транзакций и файлов
CREATE TABLE transaction_attachments (
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES attached_files(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, file_id)
);

-- Создаем представление для статистики
CREATE VIEW statistics AS
WITH income_by_category AS (
  SELECT 
    c.id AS category_id,
    c.name AS category_name,
    SUM(t.amount) AS total
  FROM transactions t
  JOIN categories c ON t.category_id = c.id
  WHERE t.type = 'income' AND t.deleted_at IS NULL
  GROUP BY c.id, c.name
),
expense_by_category AS (
  SELECT 
    c.id AS category_id,
    c.name AS category_name,
    SUM(t.amount) AS total
  FROM transactions t
  JOIN categories c ON t.category_id = c.id
  WHERE t.type = 'expense' AND t.deleted_at IS NULL
  GROUP BY c.id, c.name
)
SELECT
  (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'income' AND deleted_at IS NULL) AS total_income,
  (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'expense' AND deleted_at IS NULL) AS total_expense,
  (SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE deleted_at IS NULL) AS balance,
  (SELECT json_object_agg(category_name, total) FROM income_by_category) AS income_by_category,
  (SELECT json_object_agg(category_name, total) FROM expense_by_category) AS expense_by_category;

-- Создаем индексы для оптимизации запросов
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_counterparty_id ON transactions(counterparty_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);

-- Настройки безопасности RLS (отключаем для разработки)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE attached_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY; 