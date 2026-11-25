-- ============================================================
-- 388_counterparty_certificates.sql
-- Контрагенты, этап 3: сертификаты соответствия, декларации и лицензии на
-- алкоголь со сроком действия и напоминаниями за 30 и за 7 дней.
-- Дизайн: docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md §6.
--
--   * counterparty_certificates — дочерние записи контрагента, удаляются
--     насовсем (без архива), вместе с контрагентом — каскадом;
--   * скан не загружается отдельно: ссылка на один из документов этого же
--     контрагента (account_files), при удалении файла ссылка обнуляется;
--   * читать — finance.view_counterparties, менять — finance.manage_counterparties;
--   * enqueue_counterparty_certificate_notifications() — ежедневный воркер
--     (зовётся из /api/cron/finance-recurring), только для service_role.
-- ============================================================

create table public.counterparty_certificates (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  counterparty_id uuid not null,
  kind            text not null,
  number          text,
  product         text,
  valid_from      date,
  valid_until     date,
  file_id         uuid references public.account_files(id) on delete set null,
  note            text,
  -- Дата окончания, для которой уже отправлено напоминание за 30 / за 7 дней.
  -- Новая дата — новый отсчёт: воркер сравнивает её с valid_until.
  notified_30_for date,
  notified_7_for  date,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz,
  updated_by      uuid references public.profiles(id) on delete set null,

  constraint counterparty_certificates_account_id_id_key unique (account_id, id),
  constraint counterparty_certificates_counterparty_fkey
    foreign key (account_id, counterparty_id)
    references public.counterparties(account_id, id)
    on delete cascade,
  constraint counterparty_certificates_kind_check
    check (kind in ('conformity_certificate', 'conformity_declaration', 'alcohol_license', 'other')),
  constraint counterparty_certificates_dates_check
    check (valid_from is null or valid_until is null or valid_from <= valid_until),
  constraint counterparty_certificates_text_check
    check (
      coalesce(char_length(number), 0) <= 100
      and coalesce(char_length(product), 0) <= 500
      and coalesce(char_length(note), 0) <= 2000
    )
);

comment on table public.counterparty_certificates is
  'Сертификаты, декларации и лицензии контрагента со сроком действия (этап 3 контрагентов).';

-- Композитный FK требует композитного индекса (cascade delete).
create index counterparty_certificates_counterparty_idx
  on public.counterparty_certificates (account_id, counterparty_id);
create index counterparty_certificates_valid_until_idx
  on public.counterparty_certificates (valid_until)
  where valid_until is not null;
create index counterparty_certificates_created_by_idx
  on public.counterparty_certificates (created_by) where created_by is not null;
create index counterparty_certificates_updated_by_idx
  on public.counterparty_certificates (updated_by) where updated_by is not null;
create index counterparty_certificates_file_idx
  on public.counterparty_certificates (file_id)
  where file_id is not null;

-- Файл прикреплён к этому контрагенту активного аккаунта? SECURITY DEFINER:
-- проверка не должна зависеть от права смотреть вложения — иначе
-- управляющий без него не мог бы сохранить сертификат со сканом.
create or replace function public.counterparty_file_linked(p_file_id uuid, p_counterparty_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from public.counterparty_attachments ca
      join public.counterparties c on c.id = ca.counterparty_id
     where ca.file_id = p_file_id
       and ca.counterparty_id = p_counterparty_id
       and c.account_id = public.get_active_account_id()
  )
$$;

revoke all on function public.counterparty_file_linked(uuid, uuid) from public, anon;
grant execute on function public.counterparty_file_linked(uuid, uuid) to authenticated;

alter table public.counterparty_certificates enable row level security;

create policy "counterparty_certificates_select"
  on public.counterparty_certificates for select
  to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.view_counterparties'))
  );

-- Скан — только документ этого же контрагента (не чужой файл по id).
create policy "counterparty_certificates_insert"
  on public.counterparty_certificates for insert
  to authenticated
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_counterparties'))
    and (
      file_id is null
      or public.counterparty_file_linked(file_id, counterparty_id)
    )
  );

create policy "counterparty_certificates_update"
  on public.counterparty_certificates for update
  to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_counterparties'))
  )
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_counterparties'))
    and (
      file_id is null
      or public.counterparty_file_linked(file_id, counterparty_id)
    )
  );

create policy "counterparty_certificates_delete"
  on public.counterparty_certificates for delete
  to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_counterparties'))
  );

grant select, insert, update, delete on public.counterparty_certificates to authenticated;
revoke all on public.counterparty_certificates from anon;

-- ── Ежедневные напоминания ──────────────────────────────────
-- Порог 30 дней и порог 7 дней, каждый один раз на текущую дату окончания.
-- Если запись сразу попала в 7 дней (или уже просрочена) — одно
-- уведомление, отмечаются оба порога. Получатели — активные участники
-- живых заведений аккаунта, чья роль даёт finance.view_counterparties.
-- Захват строк — UPDATE … RETURNING: параллельный запуск их не повторит.
create or replace function public.enqueue_counterparty_certificate_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_inserted integer := 0;
  v_count    integer;
  r          record;
  v_days     integer;
  v_kind     text;
  v_title    text;
  v_body     text;
begin
  for r in
    -- «Сегодня» — в поясе аккаунта (как у повторяющихся платежей, 378):
    -- cron идёт в 00:05 по Москве, а это ещё вчера по UTC.
    with due as (
      select c.id,
             c.valid_until,
             t.today,
             (c.valid_until - t.today) as days_left
        from public.counterparty_certificates c
        join public.counterparties cp
          on cp.account_id = c.account_id and cp.id = c.counterparty_id
        cross join lateral (select private.finance_account_today(c.account_id) as today) t
       where c.valid_until is not null
         and cp.deleted_at is null
         and c.valid_until <= t.today + 30
         and (
           c.notified_30_for is distinct from c.valid_until
           or (c.valid_until <= t.today + 7 and c.notified_7_for is distinct from c.valid_until)
         )
       for update of c skip locked
    )
    update public.counterparty_certificates c
       set notified_30_for = due.valid_until,
           notified_7_for  = case when due.days_left <= 7 then due.valid_until else c.notified_7_for end
      from due
     where c.id = due.id
    returning c.id, c.account_id, c.counterparty_id, c.kind, c.number, c.product, c.valid_until, due.today,
              (select name from public.counterparties x
                where x.account_id = c.account_id and x.id = c.counterparty_id) as counterparty_name
  loop
    v_days := r.valid_until - r.today;
    v_kind := case r.kind
      when 'conformity_certificate' then 'Сертификат соответствия'
      when 'conformity_declaration' then 'Декларация о соответствии'
      when 'alcohol_license'        then 'Лицензия на алкоголь'
      else 'Документ'
    end;
    v_title := case
      when v_days < 0 then 'Просрочен: '
      when v_days = 0 then 'Истекает сегодня: '
      else 'Истекает через ' || v_days || ' дн.: '
    end || lower(left(v_kind, 1)) || substr(v_kind, 2) || ', ' || r.counterparty_name;
    v_body := concat_ws(' · ',
      v_kind || coalesce(' № ' || r.number, ''),
      case when r.product is not null then 'на «' || r.product || '»' end,
      'действует до ' || to_char(r.valid_until, 'DD.MM.YYYY')
    );

    insert into public.notifications
      (user_id, type, category, title, body, link, entity_type, entity_id, payload)
    select distinct uvr.user_id,
           'finance.certificate_expiring',
           'finance',
           v_title,
           v_body,
           '/finance/counterparties/' || r.counterparty_id || '?tab=documents',
           'counterparty_certificate',
           r.id,
           jsonb_build_object(
             'counterparty_id', r.counterparty_id,
             'valid_until', r.valid_until,
             'days_left', v_days
           )
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      join public.role_permissions rp on rp.role_id = uvr.role_id and rp.granted
      join public.permissions p on p.id = rp.permission_id
     where v.account_id = r.account_id
       and v.archived_at is null
       and uvr.status = 'active'
       and p.code = 'finance.view_counterparties';
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.enqueue_counterparty_certificate_notifications() from public, anon, authenticated;
grant execute on function public.enqueue_counterparty_certificate_notifications() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.enqueue_counterparty_certificate_notifications()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.enqueue_counterparty_certificate_notifications()', 'EXECUTE')
  then
    raise exception 'Права на рассылку напоминаний о сертификатах не сняты: применяйте миграцию от владельца (supabase_admin)';
  end if;
  if has_function_privilege('anon', 'public.counterparty_file_linked(uuid, uuid)', 'EXECUTE') then
    raise exception 'Проверка скана доступна анониму: применяйте миграцию от владельца (supabase_admin)';
  end if;
  if not has_table_privilege('authenticated', 'public.counterparty_certificates', 'SELECT') then
    raise exception 'Нет права чтения сертификатов у authenticated: применяйте миграцию от владельца (supabase_admin)';
  end if;
end
$$;
