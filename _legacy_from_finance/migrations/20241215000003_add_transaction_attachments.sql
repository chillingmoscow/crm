-- Удаляем старые таблицы если они существуют
DROP TABLE IF EXISTS transaction_attachments;
DROP TABLE IF EXISTS attached_files;

-- Создание таблицы для хранения прикрепленных файлов (новая схема)
CREATE TABLE transaction_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    file_name VARCHAR(512) NOT NULL,
    file_type VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    storage_path VARCHAR(1024) NOT NULL,
    public_url TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX idx_transaction_attachments_transaction_id 
    ON transaction_attachments(transaction_id);

CREATE INDEX idx_transaction_attachments_uploaded_by 
    ON transaction_attachments(uploaded_by);

CREATE INDEX idx_transaction_attachments_uploaded_at 
    ON transaction_attachments(uploaded_at);

-- Отключаем RLS для разработки (как в основной схеме)
ALTER TABLE transaction_attachments DISABLE ROW LEVEL SECURITY;

-- Комментарии к таблице и столбцам
COMMENT ON TABLE transaction_attachments IS 'Таблица для хранения прикрепленных файлов к транзакциям';
COMMENT ON COLUMN transaction_attachments.id IS 'Уникальный идентификатор файла';
COMMENT ON COLUMN transaction_attachments.transaction_id IS 'ID транзакции, к которой прикреплен файл';
COMMENT ON COLUMN transaction_attachments.file_name IS 'Оригинальное название файла';
COMMENT ON COLUMN transaction_attachments.file_type IS 'MIME тип файла';
COMMENT ON COLUMN transaction_attachments.file_size IS 'Размер файла в байтах';
COMMENT ON COLUMN transaction_attachments.storage_path IS 'Путь к файлу в Supabase Storage';
COMMENT ON COLUMN transaction_attachments.public_url IS 'Публичный URL для доступа к файлу';
COMMENT ON COLUMN transaction_attachments.uploaded_by IS 'ID пользователя, загрузившего файл';
COMMENT ON COLUMN transaction_attachments.uploaded_at IS 'Дата и время загрузки файла'; 