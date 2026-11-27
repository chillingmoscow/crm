-- Фоновое создание акта инвентаризации.
--
-- Панель «Создать акт» заводит акт в Quick Resto и у нас сразу, а позиции
-- (сотни, по одной, с паузой — так Quick Resto их принимает) досылает
-- задание из этой таблицы. Задание переживает закрытие вкладки и перезапуск
-- процесса: его берут с арендой (lease_until) — сначала сразу после создания
-- акта, а если процесс упал, то cron `/api/cron/candidates` (раз в 15 секунд).
-- Повтор сверяется с тем, что уже лежит в акте Quick Resto, дублей нет.
--
-- Таблица только для сервера: RLS включён без политик, доступ — service_role.
-- Ход создания в списке актов сервер читает сам по видимым пользователю актам.

create table public.inventory_act_creation_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  document_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  -- Акт в Quick Resto (documents.external_id числом).
  external_id bigint not null,
  -- План: [{key, productId, name, sample}] — что положить в акт.
  items jsonb not null,
  total integer not null check (total > 0),
  done integer not null default 0 check (done >= 0),
  -- Для журнала и уведомлений: группы, комментарий, пропущенные позиции.
  details jsonb not null default '{}',
  state text not null default 'pending'
    check (state in ('pending', 'working', 'error', 'complete')),
  error text,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (account_id, id),
  -- Удалили акт — задание уходит вместе с ним.
  foreign key (account_id, document_id) references public.documents(account_id, id) on delete cascade
);

-- Одно задание на акт; индекс заодно покрывает композитный FK.
create unique index inventory_act_creation_jobs_document
  on public.inventory_act_creation_jobs (account_id, document_id);
create index inventory_act_creation_jobs_open
  on public.inventory_act_creation_jobs (available_at) where state <> 'complete';
create index inventory_act_creation_jobs_actor
  on public.inventory_act_creation_jobs (actor_id);

alter table public.inventory_act_creation_jobs enable row level security;
revoke all on public.inventory_act_creation_jobs from public, anon, authenticated;
grant all on public.inventory_act_creation_jobs to service_role;

-- Взять задание в работу на 3 минуты (обработчик продлевает аренду по ходу).
-- p_id — конкретное задание (сразу после создания акта или по «Повторить»),
-- без него — следующее доступное для cron: не больше 8 попыток.
create or replace function public.inventory_act_creation_claim(p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  j public.inventory_act_creation_jobs;
begin
  select * into j
    from public.inventory_act_creation_jobs
   where (p_id is null or id = p_id)
     and state <> 'complete'
     and (lease_until is null or lease_until < now())
     and (p_id is not null or (available_at <= now() and attempts < 8))
   order by created_at
   for update skip locked
   limit 1;
  if not found then
    return null;
  end if;
  update public.inventory_act_creation_jobs
     set state = 'working',
         attempts = attempts + 1,
         lease_until = now() + interval '3 minutes'
   where id = j.id
  returning * into j;
  return to_jsonb(j);
end
$$;

revoke all on function public.inventory_act_creation_claim(uuid) from public, anon, authenticated;
grant execute on function public.inventory_act_creation_claim(uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.inventory_act_creation_claim(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.inventory_act_creation_claim(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.inventory_act_creation_claim(uuid)', 'execute') then
    raise exception 'inventory_act_creation_claim: права на вызов выставлены неверно';
  end if;
  if has_table_privilege('anon', 'public.inventory_act_creation_jobs', 'select')
     or has_table_privilege('authenticated', 'public.inventory_act_creation_jobs', 'select') then
    raise exception 'inventory_act_creation_jobs: таблица не должна читаться пользователями';
  end if;
end
$$;

comment on table public.inventory_act_creation_jobs is
  'Фоновое добавление позиций в акт, созданный из Sheerly (панель «Создать акт»). Только сервер.';
