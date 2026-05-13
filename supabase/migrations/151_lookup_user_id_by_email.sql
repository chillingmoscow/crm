-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 151_lookup_user_id_by_email.sql
--
-- RPC для проверки «есть ли уже user с этим email» — нужно для:
--   • inviteStaff: чтобы письмо-приглашение выбрало правильный шаблон
--     («Войдите» vs «Создайте пароль»);
--   • /invite/accept: чтобы форма показала правильное состояние;
--   • acceptInvitation: чтобы решить createUser vs signInWithPassword.
--
-- Раньше использовали admin.auth.admin.listUsers() — но в supabase-js
-- v2.48 он возвращает только первую страницу (default 50 юзеров).
-- При росте базы существующие юзера начнут «пропадать» и попадать на
-- путь createUser, который потом упадёт с «email already registered»
-- (Codex P1 на #271).
--
-- Прямой запрос к auth.users через SQL функцию-RPC с security definer
-- решает проблему: 1 round-trip, O(индекс), независимо от размера базы.
--
-- Возвращает uuid юзера, NULL если нет. Доступна только authenticated +
-- service_role: anon не должен мочь enumerate email'ы.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

-- Доступ только service_role: используем из server actions через admin
-- client. Authenticated юзерам это давать незачем — единственный
-- легитимный пользователь функции это invite/accept-flow на сервере,
-- а authenticated может пробовать enumerate'ить чужие email'ы.
revoke execute on function public.lookup_user_id_by_email(text) from anon, public, authenticated;
grant execute on function public.lookup_user_id_by_email(text) to service_role;
