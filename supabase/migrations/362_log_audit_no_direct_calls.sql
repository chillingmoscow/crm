-- ============================================================
-- 362_log_audit_no_direct_calls.sql
-- Журнал аудита нельзя дописать напрямую через API.
--
-- log_audit() — SECURITY DEFINER с EXECUTE у anon/authenticated:
-- любой вошедший сотрудник мог вызвать POST /rest/v1/rpc/log_audit
-- (или мутацию pg_graphql) и записать в журнал своего аккаунта любое
-- событие — «уволил(а) Иванова», «удалил(а) транзакцию» — от своего имени.
--
-- Отозвать EXECUTE нельзя: функцию вызывают триггеры аудита, а триггерная
-- функция без SECURITY DEFINER проверяет права вызывающего (authenticated).
-- Поэтому функция сама отказывает, когда её вызвали ВЕРХНИМ уровнем от
-- имени пользователя API: в стеке PG_CONTEXT тогда одна строка — сама
-- log_audit. Вызов из триггера или другой функции (стек глубже) работает
-- как прежде. Сервер (service_role, миграции под postgres) не ограничиваем.
--
-- Приложение больше не вызывает rpc('log_audit') — события из server
-- actions пишет writeAuditEvent (src/lib/audit/write.ts).
-- ============================================================

create or replace function public.log_audit(
  p_action_code text,
  p_entity_type text,
  p_entity_id   uuid,
  p_details     jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_stack text;
begin
  -- `role` — роль, на которую переключился PostgREST (SET LOCAL ROLE);
  -- SECURITY DEFINER её не меняет, поэтому видна и здесь.
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    get diagnostics v_stack = pg_context;
    -- Строки стека разделены переводом строки; верхний уровень = одна строка.
    if position(E'\n' in v_stack) = 0 then
      raise exception 'Запись в журнал аудита напрямую запрещена'
        using errcode = '42501';
    end if;
  end if;

  insert into public.audit_logs (
    account_id, legal_entity_id, venue_id, user_id,
    action_code, entity_type, entity_id, details
  ) values (
    public.get_active_account_id(),
    public.get_active_legal_entity_id(),
    public.get_active_venue_id(),
    auth.uid(),
    p_action_code, p_entity_type, p_entity_id, p_details
  );
end;
$$;

comment on function public.log_audit(text, text, uuid, jsonb) is
  'Записать строку в audit_logs. Контекст (account/legal_entity/venue/user) '
  'берётся из активной сессии. Только из триггеров и функций БД: прямой '
  'вызов от anon/authenticated (rpc, graphql) отклоняется (миграция 362).';

-- CREATE OR REPLACE сохраняет права; проверяем, что триггеры по-прежнему
-- могут вызывать функцию от имени пользователя.
do $$
begin
  if not has_function_privilege('authenticated', 'public.log_audit(text, text, uuid, jsonb)', 'execute') then
    raise exception 'authenticated потерял EXECUTE на log_audit — триггеры аудита сломаются';
  end if;
end;
$$;
