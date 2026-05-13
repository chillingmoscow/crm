-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 152_invalidate_user_sessions.sql
--
-- RPC для force-logout всех сессий пользователя. Используется после
-- смены email (issue #266): когда юзер сменил email через
-- /auth/confirm-email-change, его старые JWT-token'ы остаются
-- валидными до естественного истечения (~1 час). Refresh-token'ы
-- позволяют их обновлять бесконечно — что значит другие вкладки
-- юзера остаются авторизованными со СТАРЫМ email в JWT-claim'ах.
--
-- Удаляем refresh_tokens и sessions для юзера в auth-схеме:
--   • После expiry текущего access-token'а (max 1 час) refresh
--     упадёт → клиент авто-logout.
--   • Окно 1 час — known limitation. Полный immediate logout требует
--     middleware-check на каждом запросе (сравнить email-claim с DB);
--     не делаем пока — overhead на каждый request не оправдан.
--
-- Доступ только service_role: вызывается из server-route'а через
-- admin client (createAdminClient). RPC удаляет данные в auth-схеме
-- (security-sensitive), authenticated юзерам это давать незачем.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.invalidate_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  -- Удаляем refresh_tokens (родительская таблица для sessions).
  -- Cascade-delete на auth.sessions срабатывает автоматически через FK.
  with deleted as (
    delete from auth.refresh_tokens
    where user_id = p_user_id::text
    returning 1
  )
  select count(*) into v_deleted from deleted;

  -- Sessions могли остаться без refresh_tokens (если cascade FK не
  -- настроен) — добиваем явно. Гарантия что ни одной активной сессии
  -- юзера не останется в DB.
  delete from auth.sessions where user_id = p_user_id;

  return v_deleted;
end;
$$;

-- Только service_role: вызывается из /auth/confirm-email-change через
-- admin client. Authenticated юзер не должен иметь возможность снести
-- сессии произвольного p_user_id.
revoke execute on function public.invalidate_user_sessions(uuid) from anon, public, authenticated;
grant execute on function public.invalidate_user_sessions(uuid) to service_role;
