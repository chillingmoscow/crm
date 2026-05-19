-- ============================================================
-- seed.sql — тестовые данные для локальной разработки
-- Запускается автоматически при: supabase db reset
-- ============================================================

-- ============================================================
-- Тестовые пользователи (через auth.users)
-- После INSERT триггер handle_new_user создаёт запись в profiles
-- ============================================================

-- Владелец: owner@test.com / password123
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'owner@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Тест","last_name":"Владелец"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

-- Управляющий: manager@test.com / password123
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  'bbbbbbbb-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'manager@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Тест","last_name":"Управляющий"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

-- Официант: waiter@test.com / password123
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  'cccccccc-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'waiter@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Иван","last_name":"Официантов"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

-- Добавляем identity записи (нужны для правильной работы auth)
insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'owner@test.com',
    '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","email":"owner@test.com"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'manager@test.com',
    '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","email":"manager@test.com"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    'cccccccc-0000-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000003',
    'waiter@test.com',
    '{"sub":"cccccccc-0000-0000-0000-000000000003","email":"waiter@test.com"}',
    'email',
    now(),
    now(),
    now()
  );

-- ============================================================
-- Аккаунт и заведение для тестового владельца
-- (trigger уже создал profiles — теперь добавляем аккаунт и venue)
-- ============================================================

-- Аккаунт
insert into public.accounts (id, name, owner_id)
values (
  'cccccccc-0000-0000-0000-000000000001',
  'Тестовое заведение',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Заведение
insert into public.venues (
  id,
  account_id,
  name,
  type,
  address,
  phone,
  currency,
  timezone,
  working_hours
)
values (
  'dddddddd-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001',
  'Ресторан "Тест"',
  'restaurant',
  'г. Москва, ул. Тестовая, 1',
  '+7 (999) 000-00-00',
  'RUB',
  'Europe/Moscow',
  '{
    "mon": {"open": "10:00", "close": "23:00", "closed": false},
    "tue": {"open": "10:00", "close": "23:00", "closed": false},
    "wed": {"open": "10:00", "close": "23:00", "closed": false},
    "thu": {"open": "10:00", "close": "23:00", "closed": false},
    "fri": {"open": "10:00", "close": "00:00", "closed": false},
    "sat": {"open": "12:00", "close": "00:00", "closed": false},
    "sun": {"closed": true}
  }'
);

-- После миграции 170 (Stage D venue-scoped refactor) кастомные роли
-- venue-scoped, не account-scoped. Сеем preset через venue-аналог.
-- Auth-guard в seed_default_venue_roles требует active UVR caller'а в
-- этом аккаунте — в seed.sql session запускается как supabase_admin
-- без auth.uid(), и эта функция упадёт. Поэтому в seed обходим RPC
-- и сидим инлайн: создаём 5 ролей в venue + копируем permissions
-- из preset (так же, как делает сама RPC).
do $$
declare
  v_venue_id uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_role_id  uuid;
  v_def       record;
begin
  for v_def in
    select * from (values
      ('Управляющий',  'custom_manager',    array[
        'people.view_staff','people.view_staff_details','people.invite_staff','people.edit_staff',
        'people.view_roles','org.view_account','org.view_venues',
        'finance.view_dashboard','finance.view_transactions','finance.create_transaction',
        'finance.update_transaction','finance.view_bank_accounts','finance.view_categories',
        'finance.view_counterparties','finance.upload_attachments','finance.view_attachments',
        'inventory.view_products','inventory.manage_products',
        'inventory.view_stores','inventory.manage_stores',
        'inventory.view_documents','inventory.manage_documents','inventory.fill_assigned_documents',
        'inventory.view_results','inventory.sync_quickresto',
        'inventory.comment_results','inventory.adjust_results',
        'inventory.finalize_results','inventory.use_ai_suggestions',
        'crm.view_guests','crm.view_guest_details','crm.manage_guests',
        'crm.view_reservations','crm.manage_reservations','crm.cancel_reservation',
        'crm.view_loyalty','settings.manage_notifications','settings.use_dadata']),
      ('Администратор', 'custom_admin',      array[
        'people.view_staff','people.view_staff_details','people.invite_staff','people.edit_staff',
        'people.terminate_staff','people.view_roles','people.manage_roles',
        'org.view_account','org.view_legal_entities','org.view_venues','org.manage_venues','org.view_audit',
        'finance.view_dashboard','finance.view_transactions','finance.create_transaction',
        'finance.update_transaction','finance.update_any_transaction','finance.delete_transaction',
        'finance.view_bank_accounts','finance.manage_bank_accounts','finance.view_categories',
        'finance.manage_categories','finance.view_counterparties','finance.manage_counterparties',
        'finance.upload_attachments','finance.view_attachments','finance.delete_attachments',
        'finance.export','finance.view_all_venues','finance.view_all_legal_entities',
        'inventory.view_products','inventory.manage_products',
        'inventory.view_stores','inventory.manage_stores',
        'inventory.view_documents','inventory.manage_documents','inventory.fill_assigned_documents',
        'inventory.view_results','inventory.sync_quickresto',
        'inventory.comment_results','inventory.adjust_results',
        'inventory.finalize_results','inventory.use_ai_suggestions',
        'crm.view_guests','crm.view_guest_details','crm.manage_guests',
        'crm.view_reservations','crm.manage_reservations','crm.cancel_reservation',
        'crm.view_loyalty','crm.manage_loyalty',
        'settings.manage_integrations','settings.manage_notifications','settings.use_dadata']),
      ('Бухгалтер',     'custom_accountant', array[
        'people.view_staff','people.view_staff_details',
        'org.view_account','org.view_legal_entities','org.manage_legal_entities',
        'org.view_venues','org.view_audit',
        'finance.view_dashboard','finance.view_transactions','finance.create_transaction',
        'finance.update_transaction','finance.update_any_transaction','finance.delete_transaction',
        'finance.view_bank_accounts','finance.manage_bank_accounts','finance.view_categories',
        'finance.manage_categories','finance.view_counterparties','finance.manage_counterparties',
        'finance.upload_attachments','finance.view_attachments','finance.delete_attachments',
        'finance.export','finance.view_all_venues','finance.view_all_legal_entities','settings.use_dadata']),
      ('Хостес',        'custom_hostess',    array[
        'org.view_venues','inventory.fill_assigned_documents',
        'crm.view_guests','crm.view_guest_details','crm.manage_guests',
        'crm.view_reservations','crm.manage_reservations','crm.cancel_reservation']),
      ('Официант',      'custom_waiter',     array[
        'org.view_venues','inventory.fill_assigned_documents','crm.view_guests',
        'crm.view_reservations','crm.manage_reservations'])
    ) as t(name, code, perms)
  loop
    insert into public.roles (venue_id, name, code)
    values (v_venue_id, v_def.name, v_def.code)
    returning id into v_role_id;

    -- Триггер roles_apply_default_inventory_permissions (миграция 175)
    -- уже мог вставить inventory-права при INSERT роли выше — делаем
    -- вставку идемпотентной, чтобы seed не падал на дубле PK.
    insert into public.role_permissions (role_id, permission_id, granted)
    select v_role_id, id, true from public.permissions where code = any(v_def.perms)
    on conflict (role_id, permission_id) do nothing;
  end loop;
end $$;

-- Привязываем владельца к заведению (роль owner — единственная системная)
insert into public.user_venue_roles (user_id, venue_id, role_id)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001' -- системная роль owner
);

-- Привязываем управляющего к заведению (per-account custom_manager)
insert into public.user_venue_roles (user_id, venue_id, role_id, invited_by)
values (
  'bbbbbbbb-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000001',
  (
    select id from public.roles
    where venue_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
      and code     = 'custom_manager'
  ),
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Привязываем официанта к заведению (per-account custom_waiter)
insert into public.user_venue_roles (user_id, venue_id, role_id, invited_by)
values (
  'cccccccc-0000-0000-0000-000000000003',
  'dddddddd-0000-0000-0000-000000000001',
  (
    select id from public.roles
    where venue_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
      and code     = 'custom_waiter'
  ),
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Устанавливаем активное заведение для всех пользователей
update public.profiles
set active_venue_id = 'dddddddd-0000-0000-0000-000000000001'
where id in (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'cccccccc-0000-0000-0000-000000000003'
);

-- Дополнительные данные профилей для демонстрации.
-- employment_date после миграции 132 переехал в staff_account_details
-- (account-scoped). Заполняем там же через upsert.
update public.profiles set
  phone       = '+7 (999) 111-11-11',
  gender      = 'male',
  birth_date  = '1985-03-15'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

update public.profiles set
  phone       = '+7 (999) 222-22-22',
  telegram_id = '@manager_test',
  gender      = 'female',
  birth_date  = '1990-07-22'
where id = 'bbbbbbbb-0000-0000-0000-000000000002';

update public.profiles set
  phone       = '+7 (999) 333-33-33',
  gender      = 'male',
  birth_date  = '1998-11-05'
where id = 'cccccccc-0000-0000-0000-000000000003';

-- Account-scoped HR-данные: дата трудоустройства в staff_account_details.
insert into public.staff_account_details (account_id, user_id, employment_date)
values
  ('cccccccc-0000-0000-0000-000000000001'::uuid,
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid, '2023-01-10'),
  ('cccccccc-0000-0000-0000-000000000001'::uuid,
   'bbbbbbbb-0000-0000-0000-000000000002'::uuid, '2023-06-01'),
  ('cccccccc-0000-0000-0000-000000000001'::uuid,
   'cccccccc-0000-0000-0000-000000000003'::uuid, '2024-03-15')
on conflict (account_id, user_id) do update
  set employment_date = excluded.employment_date;

-- Тестовые уведомления для владельца
insert into public.notifications (user_id, venue_id, type, title, body, read, created_at)
values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'system',
    'Добро пожаловать в CRM',
    'Система управления персоналом настроена и готова к работе. Начните с приглашения сотрудников.',
    false,
    now() - interval '5 minutes'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'invite',
    'Новый сотрудник принял приглашение',
    'Иван Официантов подтвердил приглашение и добавлен в заведение «Ресторан "Тест"».',
    false,
    now() - interval '2 hours'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'system',
    'Медицинские книжки',
    'У 2 сотрудников скоро истекает срок медицинской книжки. Проверьте раздел «Сотрудники».',
    true,
    now() - interval '1 day'
  );

-- ============================================================
-- Демо-данные номенклатуры/документов для локальной разработки
-- account = Тестовое заведение (cccccccc-0000-0000-0000-000000000001)
-- ============================================================
do $$
declare
  v_account uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_owner   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_g_veg   uuid := '11111111-1111-0000-0000-000000000001';
  v_g_milk  uuid := '11111111-1111-0000-0000-000000000002';
  v_g_meat  uuid := '11111111-1111-0000-0000-000000000003';
  v_p_tom   uuid := '22222222-2222-0000-0000-000000000001';
  v_p_cuc   uuid := '22222222-2222-0000-0000-000000000002';
  v_p_milk  uuid := '22222222-2222-0000-0000-000000000003';
  v_p_chs   uuid := '22222222-2222-0000-0000-000000000004';
  v_p_beef  uuid := '22222222-2222-0000-0000-000000000005';
  v_p_chk   uuid := '22222222-2222-0000-0000-000000000006';
  v_cp1     uuid := '33333333-3333-0000-0000-000000000001';
  v_cp2     uuid := '33333333-3333-0000-0000-000000000002';
  v_cp3     uuid := '33333333-3333-0000-0000-000000000003';
  v_store   uuid := '44444444-4444-0000-0000-000000000001';
  v_doc     uuid := '55555555-5555-0000-0000-000000000001';
begin
  -- Контрагенты-поставщики
  insert into public.counterparties (id, account_id, name, inn) values
    (v_cp1, v_account, 'ООО «Овощная база»',  '7700000001'),
    (v_cp2, v_account, 'ИП Молочников А.А.',   '7700000002'),
    (v_cp3, v_account, 'ООО «Мясокомбинат»',   '7700000003')
  on conflict (id) do nothing;

  -- Группы номенклатуры
  insert into public.ingredient_groups (id, account_id, external_id, name) values
    (v_g_veg,  v_account, 'grp-veg',  'Овощи'),
    (v_g_milk, v_account, 'grp-milk', 'Молочные продукты'),
    (v_g_meat, v_account, 'grp-meat', 'Мясо')
  on conflict (id) do nothing;

  -- Ингредиенты
  insert into public.ingredients
    (id, account_id, external_id, name, article, barcode, measure_unit_name,
     current_prime_cost, store_quantity_kg, stock_limit, group_id,
     local_description, synced_at)
  values
    (v_p_tom,  v_account, 'qr-1001', 'Помидоры свежие',  'OV-001', '4600001000017', 'кг',
       120.50, 34.2, 10, v_g_veg, 'Брать только грунтовые в сезон.', now() - interval '2 hours'),
    (v_p_cuc,  v_account, 'qr-1002', 'Огурцы свежие',    'OV-002', '4600001000024', 'кг',
       98.00, 21.7, 8,  v_g_veg, null, now() - interval '2 hours'),
    (v_p_milk, v_account, 'qr-2001', 'Молоко 3.2%',      'ML-001', '4600002000010', 'л',
       72.30, 56.0, 20, v_g_milk, 'Срок годности проверять при приёмке.', now() - interval '1 day'),
    (v_p_chs,  v_account, 'qr-2002', 'Сыр Моцарелла',    'ML-002', '4600002000027', 'кг',
       640.00, 12.5, 5,  v_g_milk, null, now() - interval '1 day'),
    (v_p_beef, v_account, 'qr-3001', 'Говядина (вырезка)','MS-001', '4600003000013', 'кг',
       890.00, 18.0, 6,  v_g_meat, 'Охлаждённая, не замороженная.', now() - interval '3 hours'),
    (v_p_chk,  v_account, 'qr-3002', 'Куриное филе',     'MS-002', '4600003000020', 'кг',
       310.00, 27.4, 10, v_g_meat, null, now() - interval '3 hours')
  on conflict (id) do nothing;

  -- Склад
  insert into public.stores (id, account_id, external_id, title, store_code) values
    (v_store, v_account, 'store-1', 'Основной склад', 'MAIN')
  on conflict (id) do nothing;

  -- Акт инвентаризации + позиции (для вкладки «Где используется»)
  insert into public.documents
    (id, account_id, external_id, document_number, invoice_date, store_id, status)
  values
    (v_doc, v_account, 'qr-doc-1', 'ИНВ-0001', now() - interval '1 day', v_store, 'processed')
  on conflict (id) do nothing;

  insert into public.document_items
    (account_id, document_id, external_item_id, ingredient_id, product_name,
     actual_amount, calculated_amount, difference_amount)
  values
    (v_account, v_doc, 'it-1', v_p_tom,  'Помидоры свежие', 33.0, 34.2, -1.2),
    (v_account, v_doc, 'it-2', v_p_milk, 'Молоко 3.2%',     56.0, 56.0, 0),
    (v_account, v_doc, 'it-3', v_p_beef, 'Говядина (вырезка)',17.5, 18.0, -0.5)
  on conflict (document_id, external_item_id) do nothing;

  -- Связки с поставщиками
  insert into public.ingredient_suppliers
    (account_id, ingredient_id, counterparty_id, supplier_article, supplier_price, is_preferred, note)
  values
    (v_account, v_p_tom,  v_cp1, 'OVB-TOM', 115.00, true,  'Минимальный заказ 20 кг'),
    (v_account, v_p_tom,  v_cp3, 'MK-TOM',  128.00, false, 'Запасной поставщик'),
    (v_account, v_p_cuc,  v_cp1, 'OVB-CUC', 92.00,  true,  null),
    (v_account, v_p_milk, v_cp2, 'ML-32',   70.00,  true,  'Доставка по утрам'),
    (v_account, v_p_beef, v_cp3, 'MK-BEEF', 870.00, true,  'Охлаждённая поставка')
  on conflict (account_id, ingredient_id, counterparty_id) do nothing;

  -- Журнал событий по «Помидоры свежие»
  insert into public.ingredient_journal
    (account_id, ingredient_id, event_type, payload, actor_id, created_at)
  values
    (v_account, v_p_tom, 'synced',              '{}'::jsonb,                       null,    now() - interval '2 hours'),
    (v_account, v_p_tom, 'description_updated',  '{"hasText": true}'::jsonb,        v_owner, now() - interval '90 minutes'),
    (v_account, v_p_tom, 'supplier_added',       '{"counterpartyId": "33333333-3333-0000-0000-000000000001"}'::jsonb, v_owner, now() - interval '80 minutes'),
    (v_account, v_p_tom, 'supplier_added',       '{"counterpartyId": "33333333-3333-0000-0000-000000000003"}'::jsonb, v_owner, now() - interval '70 minutes')
  on conflict do nothing;
end $$;
