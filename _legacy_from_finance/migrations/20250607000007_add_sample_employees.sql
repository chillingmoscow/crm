-- Добавление тестовых сотрудников
INSERT INTO employees (
    organization_id,
    last_name,
    first_name,
    middle_name,
    email,
    phone,
    telegram_id,
    status,
    birth_date,
    hire_date,
    legal_entity_id,
    position_id,
    notes
)
SELECT 
    org.id as organization_id,
    'Иванов' as last_name,
    'Иван' as first_name,
    'Иванович' as middle_name,
    'ivanov@example.com' as email,
    '+7 (999) 123-45-67' as phone,
    '@ivanov_ivan' as telegram_id,
    'active' as status,
    '1985-03-15'::date as birth_date,
    '2023-01-15'::date as hire_date,
    le.id as legal_entity_id,
    pos.id as position_id,
    'Ведущий специалист отдела разработки' as notes
FROM organizations org
CROSS JOIN legal_entities le 
CROSS JOIN positions pos
WHERE org.name = 'Тестовая организация'
  AND le.name = 'ООО "Ромашка"'
  AND pos.name = 'Директор'
LIMIT 1;

INSERT INTO employees (
    organization_id,
    last_name,
    first_name,
    middle_name,
    email,
    phone,
    status,
    birth_date,
    hire_date,
    legal_entity_id,
    position_id,
    notes
)
SELECT 
    org.id as organization_id,
    'Петрова' as last_name,
    'Анна' as first_name,
    'Сергеевна' as middle_name,
    'petrova@example.com' as email,
    '+7 (999) 234-56-78' as phone,
    'active' as status,
    '1990-07-22'::date as birth_date,
    '2023-02-01'::date as hire_date,
    le.id as legal_entity_id,
    pos.id as position_id,
    'Главный бухгалтер компании' as notes
FROM organizations org
CROSS JOIN legal_entities le 
CROSS JOIN positions pos
WHERE org.name = 'Тестовая организация'
  AND le.name = 'ООО "Ромашка"'
  AND pos.name = 'Бухгалтер'
LIMIT 1;

INSERT INTO employees (
    organization_id,
    last_name,
    first_name,
    email,
    status,
    hire_date,
    legal_entity_id,
    position_id,
    notes
)
SELECT 
    org.id as organization_id,
    'Сидоров' as last_name,
    'Михаил' as first_name,
    'sidorov@example.com' as email,
    'invited' as status,
    CURRENT_DATE as hire_date,
    le.id as legal_entity_id,
    pos.id as position_id,
    'Новый сотрудник, приглашение отправлено' as notes
FROM organizations org
CROSS JOIN legal_entities le 
CROSS JOIN positions pos
WHERE org.name = 'Тестовая организация'
  AND le.name = 'ИП Васильев В.В.'
  AND pos.name = 'Управляющий'
LIMIT 1;

-- Комментарий
COMMENT ON TABLE employees IS 'Таблица содержит детальную информацию о всех сотрудниках организации, включая как активных, так и приглашенных'; 