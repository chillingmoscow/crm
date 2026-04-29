-- Миграция для расширения таблицы счетов
-- Добавляем новые поля для разных типов счетов

-- Добавляем поле группа счетов
ALTER TABLE accounts ADD COLUMN group_name TEXT;

-- Добавляем поле тип счета
ALTER TABLE accounts ADD COLUMN account_type TEXT CHECK (account_type IN ('checking', 'debit_card', 'cash', 'fund')) DEFAULT 'checking';

-- Банковские поля (для расчетных счетов и дебетовых карт)
ALTER TABLE accounts ADD COLUMN bank_name TEXT;
ALTER TABLE accounts ADD COLUMN bik TEXT;
ALTER TABLE accounts ADD COLUMN account_number TEXT;
ALTER TABLE accounts ADD COLUMN correspondent_account TEXT;
ALTER TABLE accounts ADD COLUMN acquiring_percentage DECIMAL(5, 4);

-- Поля для дебетовых карт
ALTER TABLE accounts ADD COLUMN card_holder TEXT;
ALTER TABLE accounts ADD COLUMN card_number TEXT;

-- Комментарий к миграции
COMMENT ON COLUMN accounts.group_name IS 'Группа счетов для удобного группирования';
COMMENT ON COLUMN accounts.account_type IS 'Тип счета: checking (расчетный), debit_card (дебетовая карта), cash (наличные), fund (фонд)';
COMMENT ON COLUMN accounts.bank_name IS 'Название банка';
COMMENT ON COLUMN accounts.bik IS 'БИК банка';
COMMENT ON COLUMN accounts.account_number IS 'Номер счета';
COMMENT ON COLUMN accounts.correspondent_account IS 'Корреспондентский счет';
COMMENT ON COLUMN accounts.acquiring_percentage IS 'Процент эквайринга (для расчетных счетов)';
COMMENT ON COLUMN accounts.card_holder IS 'Владелец карты';
COMMENT ON COLUMN accounts.card_number IS 'Номер карты (маскированный)'; 