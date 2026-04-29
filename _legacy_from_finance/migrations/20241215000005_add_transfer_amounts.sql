-- Добавление полей для переводов с разными валютами
ALTER TABLE transactions ADD COLUMN to_amount DECIMAL(15,2);
ALTER TABLE transactions ADD COLUMN to_currency VARCHAR(3);
 
-- Добавляем комментарии
COMMENT ON COLUMN transactions.to_amount IS 'Сумма зачисления для переводов с разными валютами';
COMMENT ON COLUMN transactions.to_currency IS 'Валюта зачисления для переводов с разными валютами'; 