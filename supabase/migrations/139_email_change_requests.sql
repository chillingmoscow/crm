-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 139_email_change_requests.sql
--
-- Кастомный flow смены email вместо встроенного Supabase Auth (GoTrue):
-- последний рассылает письма через свою отдельную SMTP-конфигу, которая
-- у нас на проде не настроена → юзер получает «Error sending email change
-- email». Наш custom flow использует тот же nodemailer-транспорт, что и
-- invitation mailer (Yandex Postbox SMTP env vars).
--
-- Таблица хранит pending-запросы смены email с одноразовым токеном и
-- expiry. Confirm-route на стороне Next.js валидирует токен и вызывает
-- auth.admin.updateUserById() с service-role, минуя GoTrue email-flow.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.email_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  new_email          text not null,
  token              text not null unique,
  expires_at         timestamptz not null default (now() + interval '1 hour'),
  consumed_at        timestamptz,
  created_at         timestamptz not null default now()
);

comment on table public.email_change_requests is
  'Pending-запросы смены email (custom flow вместо GoTrue email). Токен '
  'отправляется в письме на новый email; confirm-route проверяет токен и '
  'обновляет auth.users.email через admin-клиент.';

create index if not exists email_change_requests_user_idx
  on public.email_change_requests (user_id);
create index if not exists email_change_requests_pending_idx
  on public.email_change_requests (token)
  where consumed_at is null;

alter table public.email_change_requests enable row level security;

-- RLS: юзер может только SELECT'ить свои запросы (если когда-то решим
-- показать «pending change» в UI). INSERT/UPDATE/DELETE — только через
-- server-actions с admin-client (service-role), чтобы исключить
-- enumeration / спам.

drop policy if exists "email_change_requests_select_own"
  on public.email_change_requests;
create policy "email_change_requests_select_own"
  on public.email_change_requests for select
  using (user_id = auth.uid());
