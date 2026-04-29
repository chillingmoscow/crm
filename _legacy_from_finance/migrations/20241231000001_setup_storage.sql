-- Миграция для настройки Storage для файлов транзакций
-- Эта миграция просто готовит структуру, bucket будет создан через код

-- Проверяем наличие схемы storage (должна быть по умолчанию в Supabase)
-- Если storage схема отсутствует, ничего не делаем - она создается автоматически

-- Комментарий о том, что Storage bucket будет создан автоматически приложением
SELECT 1;

-- Дополнительные индексы для производительности (если нужно)
-- CREATE INDEX IF NOT EXISTS idx_transaction_attachments_transaction_id 
--   ON transaction_attachments(transaction_id);

-- CREATE INDEX IF NOT EXISTS idx_transaction_attachments_uploaded_at 
--   ON transaction_attachments(uploaded_at); 