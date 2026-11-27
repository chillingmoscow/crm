-- План продаж заведения на месяц: оборот, к которому идёт команда.
-- Экран «Смены» показывает кольцо «оборот к плану» и прогноз на конец месяца.
--
-- План — значение настройки, а не сущность с жизненным циклом: его задают,
-- меняют и стирают (строка удаляется). История изменений — в журнале событий
-- (`sales.plan.*`, пишет server action через writeAuditEvent), поэтому
-- archived_at/архив-страница здесь не нужны.
begin;

create table public.sales_month_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  venue_id uuid not null,
  month date not null check (extract(day from month) = 1),
  turnover numeric(14, 2) not null check (turnover > 0 and turnover < 1e12),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  -- Один план на заведение и месяц; индекс покрывает и композитный FK ниже.
  unique (account_id, venue_id, month),
  foreign key (account_id, venue_id)
    references public.venues(account_id, id) on delete cascade
);
create index sales_month_plans_created_by on public.sales_month_plans(created_by);
create index sales_month_plans_updated_by on public.sales_month_plans(updated_by);

create function public.sales_month_plans_touch() returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger sales_month_plans_touch
  before update on public.sales_month_plans
  for each row execute function public.sales_month_plans_touch();

alter table public.sales_month_plans enable row level security;
revoke all on public.sales_month_plans from public, anon, authenticated;
grant all on public.sales_month_plans to service_role;
grant select, insert, update, delete on public.sales_month_plans to authenticated;

-- Видят все, кто видит смены заведения; задают — с правом настраивать смены.
create policy sales_month_plans_select on public.sales_month_plans
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('sales.view_shifts'))
  );
create policy sales_month_plans_insert on public.sales_month_plans
  for insert to authenticated
  with check (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('sales.configure_shifts'))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );
create policy sales_month_plans_update on public.sales_month_plans
  for update to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('sales.configure_shifts'))
  )
  with check (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('sales.configure_shifts'))
    and updated_by = (select auth.uid())
  );
create policy sales_month_plans_delete on public.sales_month_plans
  for delete to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('sales.configure_shifts'))
  );

-- REVOKE/GRANT от роли-не-владельца молча ничего не меняют: проверяем итог.
do $$
begin
  if has_table_privilege('anon', 'public.sales_month_plans', 'select') then
    raise exception 'План продаж: у anon остался доступ к таблице';
  end if;
  if not has_table_privilege('authenticated', 'public.sales_month_plans', 'insert') then
    raise exception 'План продаж: у authenticated нет права записи';
  end if;
end $$;

commit;
