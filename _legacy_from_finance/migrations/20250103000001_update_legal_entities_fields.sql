-- Обновление таблицы legal_entities
-- Добавляем поля для полной поддержки интерфейса
-- Миграция от 03.01.2025

-- Добавляем недостающие поля
ALTER TABLE legal_entities 
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS legal_address TEXT,
ADD COLUMN IF NOT EXISTS actual_address TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS tax_system TEXT,
ADD COLUMN IF NOT EXISTS vat_accounting_enabled BOOLEAN DEFAULT FALSE;

-- Переносим данные из старых полей в новые
UPDATE legal_entities 
SET 
  full_name = CASE 
    WHEN legal_form IS NOT NULL AND legal_form != '' 
    THEN legal_form || ' "' || name || '"'
    ELSE name 
  END,
  legal_address = address,
  actual_address = address
WHERE full_name IS NULL;

-- Обновляем существующие записи
UPDATE legal_entities 
SET 
  tax_system = 'УСН доходы',
  vat_accounting_enabled = FALSE
WHERE tax_system IS NULL; 