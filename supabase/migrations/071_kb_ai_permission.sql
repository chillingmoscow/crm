-- ============================================================
-- 071_kb_ai_permission.sql
-- Sprint B / Tier 2.2a — AI slash-команда `/ai` в редакторе.
--
-- Что делает:
--   1. Добавляет permission `kb.use_ai` (UUID …000058) — отдельное
--      право пользоваться AI-помощником в редакторе. Дефолт: те же
--      роли что у kb.create_pages (owner / admin / accountant /
--      manager). Hostess / waiter — без права (UX-cost reduction:
--      хост/официант не должны тратить AI-токены аккаунта на
--      рутинные правки своих заметок).
--   2. Добавляет колонку `accounts.ai_enabled boolean default true`.
--      Account-level kill-switch: если кто-то хочет полностью
--      отключить AI для своего account'а (privacy / cost reasons),
--      админ выставляет false руками через SQL — UI-toggle отдельным
--      pull-request'ом.
--      Дефолт = true: AI работает «из коробки» для всех существующих
--      и новых account'ов; opt-out, не opt-in.
--
-- Server-action runKbAiCommand проверяет двойной gate:
--   - account.ai_enabled = true
--   - has_permission('kb.use_ai')
--
-- Стоимость: используем DeepSeek (deepseek-chat, $0.14/1M input,
-- $0.28/1M output) — на порядок дешевле OpenAI/Anthropic. Типичный
-- /ai вызов = 200-500 input + 100-300 output tokens ≈ $0.0001/запрос.
-- ============================================================

-- ============================================================
-- 1. accounts.ai_enabled
-- ============================================================

alter table public.accounts
  add column if not exists ai_enabled boolean not null default true;

comment on column public.accounts.ai_enabled is
  'Account-level kill-switch для AI-фич (kb.use_ai и будущий kb.ask_ai). '
  'Дефолт true. Чтобы отключить — UPDATE accounts SET ai_enabled=false '
  'WHERE id=...; UI-toggle добавится отдельной фичей.';

-- ============================================================
-- 2. Permission `kb.use_ai`
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000058',
   'kb.use_ai',
   'Пользоваться AI-помощником в редакторе (slash /ai)',
   'kb');

-- Дефолтная матрица: owner / manager / admin / accountant — yes;
-- hostess / waiter — no (та же что у kb.create_pages).
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000058'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000002'::uuid),  -- manager
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000006'::uuid)   -- accountant
) as r(role_id);
