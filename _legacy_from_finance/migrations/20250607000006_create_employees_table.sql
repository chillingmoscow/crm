-- Создание таблицы сотрудников с детальной информацией
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Связи
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Может быть NULL для приглашенных
    legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE SET NULL,
    position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    
    -- Личные данные
    last_name VARCHAR(100) NOT NULL, -- Фамилия
    first_name VARCHAR(100) NOT NULL, -- Имя  
    middle_name VARCHAR(100), -- Отчество
    full_name VARCHAR(300) GENERATED ALWAYS AS (
        CASE 
            WHEN middle_name IS NOT NULL AND middle_name != '' 
            THEN last_name || ' ' || first_name || ' ' || middle_name
            ELSE last_name || ' ' || first_name
        END
    ) STORED, -- Автоматически формируемое полное имя
    
    -- Контактная информация
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    telegram_id VARCHAR(100),
    
    -- Статус и даты
    status VARCHAR(20) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'terminated')),
    birth_date DATE,
    hire_date DATE,
    termination_date DATE,
    
    -- Дополнительно
    avatar_url TEXT,
    notes TEXT,
    
    -- Служебные поля
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Индексы для оптимизации
CREATE INDEX idx_employees_organization_id ON employees(organization_id);
CREATE INDEX idx_employees_user_id ON employees(user_id);
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_employees_legal_entity ON employees(legal_entity_id);
CREATE INDEX idx_employees_position ON employees(position_id);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_employees_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION update_employees_updated_at();

-- RLS политики
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Политика для чтения: доступ только к сотрудникам своей организации
CREATE POLICY "employees_select_policy" ON employees
    FOR SELECT USING (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
        )
    );

-- Политика для вставки: только для своей организации
CREATE POLICY "employees_insert_policy" ON employees
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
        )
    );

-- Политика для обновления: только для своей организации
CREATE POLICY "employees_update_policy" ON employees
    FOR UPDATE USING (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
        )
    );

-- Политика для удаления: только для своей организации
CREATE POLICY "employees_delete_policy" ON employees
    FOR DELETE USING (
        organization_id IN (
            SELECT ua.organization_id 
            FROM user_assignments ua 
            WHERE ua.user_id = auth.uid()
        )
    );

-- Комментарии к таблице
COMMENT ON TABLE employees IS 'Детальная информация о сотрудниках организации';
COMMENT ON COLUMN employees.full_name IS 'Автоматически формируемое полное имя из фамилии, имени и отчества';
COMMENT ON COLUMN employees.status IS 'Статус сотрудника: invited, active, suspended, terminated';
COMMENT ON COLUMN employees.user_id IS 'Связь с пользователем auth.users, может быть NULL для приглашенных'; 