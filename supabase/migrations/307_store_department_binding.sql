-- Привязка склада к подразделению: недостача по складу ложится на то
-- подразделение, которому склад принадлежит («Кальяны Зал» -> кальянщики),
-- а не на всю команду.
--
-- Три состояния лежат в отдельной колонке department_scope, а не выводятся из
-- department_id is null: «ещё не настроено» и «явно общий» оба дают NULL, но
-- платят по-разному. 'unset' -> расчёт по складу неполный и это видно; 'shared'
-- -> платит общий пул команды; 'department' -> платит подразделение.
begin;

-- У departments нет account_id (колонка снята миграцией 172), подразделение
-- принадлежит заведению. Поэтому композитный FK (account_id, department_id)
-- невозможен; аккаунт подразделения проверяет триггер ниже (через venues).
alter table public.stores
  add column department_id uuid references public.departments(id) on delete set null,
  add column department_scope text not null default 'unset',
  add constraint stores_department_scope_check
    check (department_scope in ('unset', 'shared', 'department')
           and (department_scope = 'department') = (department_id is not null));

create index stores_department_idx
  on public.stores (department_id) where department_id is not null;

-- BEFORE, а не AFTER: при удалении подразделения FK on delete set null обнуляет
-- department_id, и CHECK проверяется на этой же строке сразу. Только BEFORE
-- успевает вернуть scope в 'unset', иначе удаление подразделения упало бы.
create or replace function private.stores_department_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
      join public.venues v on v.id = d.venue_id
     where d.id = new.department_id and v.account_id = new.account_id
  ) then
    raise exception 'Подразделение относится к другому аккаунту';
  end if;
  -- Подразделение пропало (удалено), а scope остался прежним -> «не задано».
  if tg_op = 'UPDATE' and old.department_id is not null and new.department_id is null
     and new.department_scope = 'department' and old.department_scope = 'department' then
    new.department_scope := 'unset';
  end if;
  return new;
end;
$$;
revoke all on function private.stores_department_guard() from public, anon, authenticated, service_role;
create trigger stores_department_guard
  before insert or update of department_id, department_scope on public.stores
  for each row execute function private.stores_department_guard();

-- История: кто, когда и как менял привязку. Название подразделения хранится
-- снимком, чтобы запись читалась и после его удаления (id без FK по той же причине).
create table public.store_department_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  store_id uuid not null,
  old_scope text not null,
  old_department_id uuid,
  old_department_name text,
  new_scope text not null,
  new_department_id uuid,
  new_department_name text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (account_id, store_id) references public.stores(account_id, id) on delete cascade
);
create index store_department_history_store_idx
  on public.store_department_history (account_id, store_id, changed_at desc);
create index store_department_history_actor_idx
  on public.store_department_history (changed_by) where changed_by is not null;
alter table public.store_department_history enable row level security;
revoke all on public.store_department_history from public, anon, authenticated, service_role;
grant select on public.store_department_history to authenticated, service_role;
create policy store_department_history_read on public.store_department_history
  for select to authenticated
  using (account_id = (select public.get_active_account_id())
         and (select public.has_permission('inventory.view_results')));

-- Пишет любое изменение привязки, включая обнуление при удалении подразделения
-- (тогда changed_by пуст, а название удалённого подразделения уже недоступно).
create or replace function private.store_department_history_log() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  insert into public.store_department_history(
    account_id, store_id, old_scope, old_department_id, old_department_name,
    new_scope, new_department_id, new_department_name, changed_by)
  values (
    new.account_id, new.id, old.department_scope, old.department_id,
    (select name from public.departments where id = old.department_id),
    new.department_scope, new.department_id,
    (select name from public.departments where id = new.department_id),
    (select auth.uid()));
  return new;
end;
$$;
revoke all on function private.store_department_history_log() from public, anon, authenticated, service_role;
create trigger store_department_history_log
  after update of department_id, department_scope on public.stores
  for each row
  when (old.department_scope is distinct from new.department_scope
        or old.department_id is distinct from new.department_id)
  execute function private.store_department_history_log();

-- Единственный путь для пользователя: authenticated не имеет UPDATE на stores.
-- Возвращает id склада; повтор с теми же значениями ничего не меняет и не пишет.
create or replace function public.set_store_department(
  p_store_id uuid, p_scope text, p_department_id uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid := public.get_active_account_id();
begin
  if auth.uid() is null or a is null or not public.has_permission('inventory.manage_stores') then
    raise exception 'Недостаточно прав для привязки склада к подразделению';
  end if;
  if p_scope is null or p_scope not in ('unset', 'shared', 'department')
     or (p_scope = 'department') <> (p_department_id is not null) then
    raise exception 'Укажите подразделение только для варианта «Подразделение»';
  end if;
  perform 1 from public.stores where id = p_store_id and account_id = a for update;
  if not found then raise exception 'Склад не найден'; end if;
  update public.stores
     set department_scope = p_scope, department_id = p_department_id
   where id = p_store_id and account_id = a
     and (department_scope is distinct from p_scope or department_id is distinct from p_department_id);
  return p_store_id;
end;
$$;
revoke all on function public.set_store_department(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.set_store_department(uuid, text, uuid) to authenticated;

commit;
