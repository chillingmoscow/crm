-- Расширенные мок-данные для организаций и юридических лиц
-- Миграция от 02.01.2025

-- 1. Очищаем существующие тестовые данные (кроме основной организации)
DELETE FROM user_assignments WHERE organization_id != '550e8400-e29b-41d4-a716-446655440100';
DELETE FROM positions WHERE organization_id != '550e8400-e29b-41d4-a716-446655440100';
DELETE FROM legal_entities WHERE organization_id != '550e8400-e29b-41d4-a716-446655440100';
DELETE FROM organizations WHERE id != '550e8400-e29b-41d4-a716-446655440100';

-- 2. Дополняем основную организацию более детальной информацией
UPDATE organizations 
SET 
  description = 'Основная организация для управления финансами',
  settings = '{
    "currency": "RUB",
    "timezone": "Europe/Moscow", 
    "reporting_period": "month",
    "auto_backup": true,
    "notifications": {
      "email": true,
      "browser": true,
      "daily_summary": true
    }
  }'::jsonb
WHERE id = '550e8400-e29b-41d4-a716-446655440100';

-- 3. Создаем дополнительные организации для демонстрации
INSERT INTO organizations (id, name, description, owner_id, settings, created_at) VALUES
('550e8400-e29b-41d4-a716-446655440110', 'Кафе "Уютный уголок"', 'Небольшое семейное кафе в центре города', '550e8400-e29b-41d4-a716-446655440001', 
 '{"currency": "RUB", "type": "cafe", "seating": 25, "kitchen_type": "european"}', NOW() - INTERVAL '3 months'),

('550e8400-e29b-41d4-a716-446655440111', 'Спортивный клуб "Олимп"', 'Сеть спортивных залов и фитнес-центров', '550e8400-e29b-41d4-a716-446655440001',
 '{"currency": "RUB", "type": "fitness", "locations": 3, "membership_types": ["basic", "premium", "vip"]}', NOW() - INTERVAL '6 months'),

('550e8400-e29b-41d4-a716-446655440112', 'Консалтинговое агентство "Бизнес Решения"', 'Консультации по развитию бизнеса и финансовому планированию', '550e8400-e29b-41d4-a716-446655440001',
 '{"currency": "RUB", "type": "consulting", "specializations": ["finance", "marketing", "hr"]}', NOW() - INTERVAL '1 year')
ON CONFLICT (id) DO NOTHING;

-- 4. Дополняем юридические лица основной организации
UPDATE legal_entities 
SET 
  inn = '123456789012',
  ogrn = '1234567890123',
  address = 'г. Москва, ул. Примерная, д. 1, оф. 101',
  phone = '+7 (495) 123-45-67',
  email = 'info@example.com',
  description = 'Основное юридическое лицо для ведения деятельности'
WHERE id = '550e8400-e29b-41d4-a716-446655440101';

UPDATE legal_entities 
SET 
  inn = '9876543210',
  ogrn = '1234567890124',
  kpp = '987654321',
  address = 'г. Москва, ул. Деловая, д. 15, стр. 3',
  phone = '+7 (495) 987-65-43',
  email = 'roga@kopyta.ru',
  description = 'Дополнительное юридическое лицо для расширения деятельности'
WHERE id = '550e8400-e29b-41d4-a716-446655440102';

-- 5. Создаем юридические лица для других организаций
INSERT INTO legal_entities (id, organization_id, name, legal_form, inn, ogrn, kpp, address, phone, email, description, is_default, created_at) VALUES
-- Для кафе
('550e8400-e29b-41d4-a716-446655440103', '550e8400-e29b-41d4-a716-446655440110', 'ИП Петров А.В.', 'ИП', '234567890123', '2345678901234', NULL, 
 'г. Москва, ул. Кафейная, д. 22', '+7 (495) 234-56-78', 'cafe@cozy.ru', 'Индивидуальный предприниматель, владелец кафе', TRUE, NOW() - INTERVAL '3 months'),

('550e8400-e29b-41d4-a716-446655440104', '550e8400-e29b-41d4-a716-446655440110', 'ООО "Уютный уголок"', 'ООО', '345678901234', '3456789012345', '345678901',
 'г. Москва, ул. Кафейная, д. 22, пом. 1', '+7 (495) 345-67-89', 'llc@cozy.ru', 'Юридическое лицо для развития сети кафе', FALSE, NOW() - INTERVAL '2 months'),

-- Для спортивного клуба
('550e8400-e29b-41d4-a716-446655440105', '550e8400-e29b-41d4-a716-446655440111', 'ООО "Олимп-Спорт"', 'ООО', '456789012345', '4567890123456', '456789012',
 'г. Москва, ул. Спортивная, д. 10', '+7 (495) 456-78-90', 'info@olimp-sport.ru', 'Основное юридическое лицо спортивного клуба', TRUE, NOW() - INTERVAL '6 months'),

('550e8400-e29b-41d4-a716-446655440106', '550e8400-e29b-41d4-a716-446655440111', 'ИП Сидоров С.С.', 'ИП', '567890123456', '5678901234567', NULL,
 'г. Москва, ул. Фитнес, д. 5', '+7 (495) 567-89-01', 'sidorov@fitness.ru', 'Индивидуальный предприниматель, тренер и совладелец', FALSE, NOW() - INTERVAL '5 months'),

-- Для консалтингового агентства  
('550e8400-e29b-41d4-a716-446655440107', '550e8400-e29b-41d4-a716-446655440112', 'ООО "Бизнес Решения"', 'ООО', '678901234567', '6789012345678', '678901234',
 'г. Москва, Деловой центр, ул. Консультантов, д. 1, оф. 501', '+7 (495) 678-90-12', 'info@biz-solutions.ru', 'Консалтинговые услуги для малого и среднего бизнеса', TRUE, NOW() - INTERVAL '1 year'),

('550e8400-e29b-41d4-a716-446655440108', '550e8400-e29b-41d4-a716-446655440112', 'ИП Козлов К.К.', 'ИП', '789012345678', '7890123456789', NULL,
 'г. Москва, ул. Эксперт, д. 33, кв. 15', '+7 (495) 789-01-23', 'kozlov@expert.ru', 'Независимый консультант по финансовому планированию', FALSE, NOW() - INTERVAL '10 months')
ON CONFLICT (id) DO NOTHING;

-- 6. Создаем расширенные должности для всех организаций
INSERT INTO positions (id, organization_id, legal_entity_id, name, description, permissions, created_at) VALUES
-- Должности основной организации (уже существуют, дополняем)
('550e8400-e29b-41d4-a716-446655440204', '550e8400-e29b-41d4-a716-446655440100', '550e8400-e29b-41d4-a716-446655440102', 'Менеджер проектов', 'Управление проектами и координация работы команды', 
 '{"manage_projects": true, "view_reports": true, "manage_transactions": false}', NOW()),

-- Должности для кафе
('550e8400-e29b-41d4-a716-446655440210', '550e8400-e29b-41d4-a716-446655440110', '550e8400-e29b-41d4-a716-446655440103', 'Управляющий кафе', 'Общее руководство кафе, контроль операций', 
 '{"manage_staff": true, "view_reports": true, "manage_transactions": true, "manage_menu": true}', NOW() - INTERVAL '3 months'),

('550e8400-e29b-41d4-a716-446655440211', '550e8400-e29b-41d4-a716-446655440110', '550e8400-e29b-41d4-a716-446655440103', 'Шеф-повар', 'Управление кухней, разработка меню', 
 '{"manage_kitchen": true, "manage_menu": true, "view_reports": false}', NOW() - INTERVAL '3 months'),

('550e8400-e29b-41d4-a716-446655440212', '550e8400-e29b-41d4-a716-446655440110', '550e8400-e29b-41d4-a716-446655440103', 'Официант', 'Обслуживание гостей, работа с кассой', 
 '{"manage_orders": true, "use_pos": true, "view_menu": true}', NOW() - INTERVAL '2 months'),

('550e8400-e29b-41d4-a716-446655440213', '550e8400-e29b-41d4-a716-446655440110', '550e8400-e29b-41d4-a716-446655440103', 'Барист', 'Приготовление кофе и напитков', 
 '{"manage_bar": true, "use_pos": true, "manage_inventory": false}', NOW() - INTERVAL '2 months'),

-- Должности для спортивного клуба
('550e8400-e29b-41d4-a716-446655440220', '550e8400-e29b-41d4-a716-446655440111', '550e8400-e29b-41d4-a716-446655440105', 'Директор клуба', 'Общее руководство спортивным клубом', 
 '{"manage_all": true, "view_reports": true, "manage_staff": true, "manage_memberships": true}', NOW() - INTERVAL '6 months'),

('550e8400-e29b-41d4-a716-446655440221', '550e8400-e29b-41d4-a716-446655440111', '550e8400-e29b-41d4-a716-446655440105', 'Персональный тренер', 'Проведение индивидуальных тренировок', 
 '{"manage_training": true, "view_schedule": true, "manage_clients": true}', NOW() - INTERVAL '5 months'),

('550e8400-e29b-41d4-a716-446655440222', '550e8400-e29b-41d4-a716-446655440111', '550e8400-e29b-41d4-a716-446655440105', 'Администратор', 'Работа с клиентами, регистрация, продажа абонементов', 
 '{"manage_memberships": true, "use_pos": true, "view_schedule": true}', NOW() - INTERVAL '4 months'),

('550e8400-e29b-41d4-a716-446655440223', '550e8400-e29b-41d4-a716-446655440111', '550e8400-e29b-41d4-a716-446655440105', 'Инструктор групповых программ', 'Проведение групповых занятий', 
 '{"manage_group_classes": true, "view_schedule": true, "manage_participants": true}', NOW() - INTERVAL '4 months'),

-- Должности для консалтингового агентства
('550e8400-e29b-41d4-a716-446655440230', '550e8400-e29b-41d4-a716-446655440112', '550e8400-e29b-41d4-a716-446655440107', 'Ведущий консультант', 'Руководство проектами, стратегическое планирование', 
 '{"manage_projects": true, "view_all_reports": true, "manage_clients": true, "approve_proposals": true}', NOW() - INTERVAL '1 year'),

('550e8400-e29b-41d4-a716-446655440231', '550e8400-e29b-41d4-a716-446655440112', '550e8400-e29b-41d4-a716-446655440107', 'Финансовый аналитик', 'Анализ финансовых показателей клиентов', 
 '{"analyze_finances": true, "create_reports": true, "view_client_data": true}', NOW() - INTERVAL '10 months'),

('550e8400-e29b-41d4-a716-446655440232', '550e8400-e29b-41d4-a716-446655440112', '550e8400-e29b-41d4-a716-446655440107', 'Бизнес-аналитик', 'Анализ бизнес-процессов и разработка рекомендаций', 
 '{"analyze_business": true, "create_reports": true, "manage_workshops": true}', NOW() - INTERVAL '8 months'),

('550e8400-e29b-41d4-a716-446655440233', '550e8400-e29b-41d4-a716-446655440112', '550e8400-e29b-41d4-a716-446655440108', 'Независимый эксперт', 'Экспертная оценка и консультации', 
 '{"provide_expertise": true, "create_assessments": true, "conduct_audits": true}', NOW() - INTERVAL '8 months')
ON CONFLICT (id) DO NOTHING;

-- 7. Создаем назначения пользователей в новые организации
INSERT INTO user_assignments (id, user_id, organization_id, legal_entity_id, position_id, role_type, permissions, accepted_at, invited_at) VALUES
-- Пользователь является владельцем всех организаций
('550e8400-e29b-41d4-a716-446655440310', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440110', 
 '550e8400-e29b-41d4-a716-446655440103', '550e8400-e29b-41d4-a716-446655440210', 'owner', 
 '{"all": true}', NOW(), NOW() - INTERVAL '3 months'),

('550e8400-e29b-41d4-a716-446655440311', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440111', 
 '550e8400-e29b-41d4-a716-446655440105', '550e8400-e29b-41d4-a716-446655440220', 'owner', 
 '{"all": true}', NOW(), NOW() - INTERVAL '6 months'),

('550e8400-e29b-41d4-a716-446655440312', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440112', 
 '550e8400-e29b-41d4-a716-446655440107', '550e8400-e29b-41d4-a716-446655440230', 'owner', 
 '{"all": true}', NOW(), NOW() - INTERVAL '1 year')
ON CONFLICT (id) DO NOTHING;

-- 8. Обновляем привязку существующих данных к новым организациям
-- Часть счетов привязываем к кафе
UPDATE accounts 
SET 
  organization_id = '550e8400-e29b-41d4-a716-446655440110',
  legal_entity_id = '550e8400-e29b-41d4-a716-446655440103'
WHERE name ILIKE '%касс%' OR name ILIKE '%наличны%';

-- Часть счетов привязываем к спортклубу  
UPDATE accounts 
SET 
  organization_id = '550e8400-e29b-41d4-a716-446655440111',
  legal_entity_id = '550e8400-e29b-41d4-a716-446655440105'
WHERE name ILIKE '%абонемент%' OR name ILIKE '%спорт%' OR name ILIKE '%фитнес%';

-- Часть категорий привязываем к разным организациям
UPDATE categories 
SET organization_id = '550e8400-e29b-41d4-a716-446655440110'
WHERE name ILIKE '%продукт%' OR name ILIKE '%кафе%' OR name ILIKE '%питан%' OR type = 'expense';

UPDATE categories 
SET organization_id = '550e8400-e29b-41d4-a716-446655440111'
WHERE name ILIKE '%абонемент%' OR name ILIKE '%спорт%' OR name ILIKE '%тренировк%';

UPDATE categories 
SET organization_id = '550e8400-e29b-41d4-a716-446655440112'
WHERE name ILIKE '%консультац%' OR name ILIKE '%услуг%' OR name ILIKE '%гонорар%';

-- Часть контрагентов привязываем к разным организациям
UPDATE counterparties 
SET organization_id = '550e8400-e29b-41d4-a716-446655440110'
WHERE name ILIKE '%поставщик%' OR name ILIKE '%продукт%' OR legal_entity ILIKE '%ип%';

UPDATE counterparties 
SET organization_id = '550e8400-e29b-41d4-a716-446655440111'
WHERE name ILIKE '%спорт%' OR name ILIKE '%оборудован%' OR name ILIKE '%фитнес%';

UPDATE counterparties 
SET organization_id = '550e8400-e29b-41d4-a716-446655440112'
WHERE name ILIKE '%клиент%' OR name ILIKE '%партнер%' OR legal_entity ILIKE '%ооо%';

-- 9. Обновляем транзакции - привязываем к соответствующим организациям
UPDATE transactions 
SET 
  organization_id = accounts.organization_id,
  legal_entity_id = accounts.legal_entity_id
FROM accounts 
WHERE transactions.account_id = accounts.id;

-- 10. Обновляем группы - распределяем по организациям
UPDATE account_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440110'
WHERE name ILIKE '%кафе%' OR name ILIKE '%касс%';

UPDATE account_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440111'
WHERE name ILIKE '%спорт%' OR name ILIKE '%абонемент%';

UPDATE category_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440110'
WHERE name ILIKE '%кафе%' OR name ILIKE '%питан%';

UPDATE category_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440111'
WHERE name ILIKE '%спорт%' OR name ILIKE '%фитнес%';

UPDATE category_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440112'
WHERE name ILIKE '%консультац%' OR name ILIKE '%услуг%';

UPDATE counterparty_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440110'
WHERE name ILIKE '%поставщик%';

UPDATE counterparty_groups 
SET organization_id = '550e8400-e29b-41d4-a716-446655440111'
WHERE name ILIKE '%клиент%' OR name ILIKE '%партнер%'; 