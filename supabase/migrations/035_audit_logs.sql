-- ============================================================
-- 035_audit_logs.sql
-- Единый журнал изменений основных сущностей.
--
-- См. docs/MERGE_PLAN.md §3.8 и §9.3.
-- Используется также для просмотра «истории изменений» одной сущности
-- через фильтр (entity_type, entity_id).
-- ============================================================

create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  venue_id        uuid references public.venues(id) on delete set null,
  user_id         uuid references public.profiles(id),

  action_code     text not null,           -- 'transaction.created', 'venue.updated' …
  entity_type     text not null,
  entity_id       uuid,

  details         jsonb not null default '{}'::jsonb,  -- diff old/new значений
  ip_address      inet,
  user_agent      text,

  created_at      timestamptz not null default now()
);

create index audit_logs_account_created_idx
  on public.audit_logs (account_id, created_at desc);

create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);

create index audit_logs_action_idx
  on public.audit_logs (action_code);

comment on table public.audit_logs is
  'Глобальный журнал аудита. Запись делается через log_audit(); прямые '
  'INSERT/UPDATE/DELETE из приложения запрещены RLS.';

-- ============================================================
-- log_audit() — единственный санкционированный способ записи.
-- SECURITY DEFINER: пишет даже из контекста, где у пользователя
-- нет прямого INSERT в audit_logs.
-- ============================================================

create or replace function public.log_audit(
  p_action_code text,
  p_entity_type text,
  p_entity_id   uuid,
  p_details     jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
  'берётся из активной сессии. Вызывать из app-кода или из триггеров.';

-- ============================================================
-- RLS — read-only для приложения. Запись только через log_audit().
-- ============================================================

alter table public.audit_logs enable row level security;

create policy "audit_logs_select"
  on public.audit_logs for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('org.view_audit')
  );

-- INSERT/UPDATE/DELETE из приложения запрещены — нет ни одной writeable
-- политики. log_audit() обходит RLS благодаря SECURITY DEFINER.
