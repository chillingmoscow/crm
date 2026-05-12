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

-- После миграции 138 единственная системная роль — owner. Остальные
-- (Управляющий / Официант / …) — кастомные per-account. Сеем их через
-- штатную функцию (она же вызывается онбордингом).
select public.seed_default_account_roles(
  'cccccccc-0000-0000-0000-000000000001'::uuid
);

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
    where account_id = 'cccccccc-0000-0000-0000-000000000001'::uuid
      and code       = 'custom_manager'
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
    where account_id = 'cccccccc-0000-0000-0000-000000000001'::uuid
      and code       = 'custom_waiter'
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
