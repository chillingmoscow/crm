-- Две правки базы знаний после ревью редизайна (28.11.2026).
--
-- 1. Отметка «Прочитано»: версию прочтения пишет клиент. Политика вставки
--    (116) её не проверяла — прямым запросом через PostgREST можно было
--    записать read_version = 999999, и «Попросить перечитать» такого
--    человека больше никогда не задевало. Теперь версия не может быть
--    больше текущей версии страницы (как её считает markKbPageAsRead:
--    последняя версия, без версий — 1). Версии видит любой, кто видит
--    страницы аккаунта (kb_page_versions_select), поэтому подзапрос
--    работает и у рядового сотрудника.
-- 2. «По месяцам» в «Обзоре» группировало чтение по месяцам UTC: чтение
--    1-го числа ночью по Москве попадало в прошлый месяц. Теперь — месяц в
--    поясе аккаунта (get_active_account_timezone, миграция 370), как и
--    окна недели и месяца в приложении.
begin;

drop policy if exists "kb_page_reads_insert_own" on public.kb_page_reads;
create policy "kb_page_reads_insert_own" on public.kb_page_reads
  for insert with check (
    user_id = (select auth.uid())
    and account_id = (select public.get_active_account_id())
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_reads.page_id
         and kp.account_id = (select public.get_active_account_id())
         and kp.deleted_at is null
         and kp.required_reading = true
    )
    and (select public.has_permission('kb.view_pages'))
    and kb_page_reads.read_version <= coalesce(
      (select max(v.version_number)
         from public.kb_page_versions v
        where v.page_id = kb_page_reads.page_id),
      1
    )
  );

create or replace function public.kb_analytics_month_stats(p_since timestamptz)
returns table (month text, total_seconds bigint, sessions bigint, readers bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select to_char(
           date_trunc('month', s.started_at at time zone public.get_active_account_timezone()),
           'YYYY-MM'
         ),
         coalesce(sum(s.duration_seconds), 0)::bigint,
         count(*)::bigint,
         count(distinct s.user_id)::bigint
    from public.kb_page_view_sessions s
   where s.account_id = public.get_active_account_id()
     and s.started_at >= p_since
   group by 1
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'kb_page_reads'
       and policyname = 'kb_page_reads_insert_own'
       and with_check like '%read_version%'
  ) then
    raise exception 'Политика kb_page_reads_insert_own не проверяет версию прочтения';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'kb_analytics_month_stats'
       and pg_get_functiondef(p.oid) like '%get_active_account_timezone%'
       and array_to_string(p.proconfig, ',') like '%search_path%'
  ) then
    raise exception 'kb_analytics_month_stats не считает месяц в поясе аккаунта';
  end if;
end;
$$;

commit;
