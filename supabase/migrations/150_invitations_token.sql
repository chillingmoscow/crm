-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 150_invitations_token.sql
--
-- Custom invite flow — добавляем `invitations.token` (UUID, уникальный).
-- Токен используется в URL'е письма-приглашения вида
-- `/invite/accept?token=<uuid>`. Раньше invite-ссылка генерировалась
-- через `admin.auth.admin.generateLink({type: 'invite'})`, а GoTrue
-- редиректил юзера на свой `SITE_URL` (= Supabase Studio в нашем
-- self-hosted setup'е), вместо нашего приложения. Чтобы навсегда
-- отвязаться от GoTrue email-flow, генерируем токен сами и обрабатываем
-- через свой роут — как уже делаем для email-change.
--
-- Lookup по token делается из /invite/accept через admin client
-- (service_role bypassит RLS). Public-policy на invitations НЕ добавляем
-- — это была бы утечка email'ов pending-инвайтов через гадание UUID.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Колонка. Default = gen_random_uuid() заполняет существующие
--    pending-инвайты случайным токеном (на эти ссылки уже никто не
--    придёт через старый flow, но данные не теряем).
alter table public.invitations
  add column if not exists token uuid not null default gen_random_uuid();

-- 2. Уникальный индекс. Без unique constraint'а есть риск (хотя и
--    мизерный) collision'а при параллельных insert'ах с одинаковым
--    случайным UUID — индекс этого не пропустит.
create unique index if not exists invitations_token_uniq on public.invitations (token);

comment on column public.invitations.token is
  'Случайный UUID, который кладётся в URL invite-письма. По нему '
  '/invite/accept ищет invitation и проверяет валидность. Уникален.';
