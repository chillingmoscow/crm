-- Акт пересчёта отдельной датой.
--
-- Расчётный остаток в Quick Resto привязан к ДАТЕ АКТА (проверено на проде:
-- акт СВ324, пять дней между подсчётом и пересчётом, 297 из 305 позиций без
-- расхождения). Поэтому позиция, которую пересчитывают на другой день, должна
-- сравниваться с остатком на дату пересчёта — то есть жить в отдельном акте с
-- этой датой. Иначе поставка между датами превращается в излишек, а продажи —
-- в недостачу.
--
-- Что добавляем:
--   1) связь «акт пересчёта → исходный акт»;
--   2) след выноса позиций (какие строки и куда ушли). Хранить его в
--      document_items нельзя: строки живут ровно столько, сколько их отдаёт
--      Quick Resto, а история выноса нужна и после того, как акт перечитали;
--   3) тип события журнала для самого выноса.

-- 1) Связь актов.
alter table public.documents
  add column if not exists recount_of_document_id uuid;

comment on column public.documents.recount_of_document_id is
  'Для акта пересчёта — исходный акт, из которого вынесли позиции. NULL у обычных актов.';

-- ON DELETE SET NULL (recount_of_document_id): у композитного FK по умолчанию
-- зануляются ОБА столбца, а documents.account_id — NOT NULL, поэтому удаление
-- исходного акта падало бы вместо отвязки дочернего. Указание конкретной
-- колонки поддерживается с PostgreSQL 15 (прод — 15.8).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_recount_of_document_fkey'
  ) then
    alter table public.documents
      add constraint documents_recount_of_document_fkey
      foreign key (account_id, recount_of_document_id)
      references public.documents (account_id, id)
      on delete set null (recount_of_document_id);
  end if;
end $$;

create index if not exists documents_recount_of_document_idx
  on public.documents (account_id, recount_of_document_id)
  where recount_of_document_id is not null;

-- 2) След выноса позиций.
create table if not exists public.inventory_recount_moves (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts (id) on delete cascade,
  document_id         uuid not null,
  recount_document_id uuid,
  external_item_id    text not null,
  product_name        text not null,
  ingredient_id       uuid,
  moved_by            uuid references public.profiles (id) on delete set null,
  moved_at            timestamptz not null default now(),
  constraint inventory_recount_moves_document_fkey
    foreign key (account_id, document_id)
    references public.documents (account_id, id) on delete cascade,
  -- Та же причина, что и у documents_recount_of_document_fkey: зануляем только
  -- ссылку на акт пересчёта, account_id трогать нельзя (NOT NULL).
  constraint inventory_recount_moves_recount_document_fkey
    foreign key (account_id, recount_document_id)
    references public.documents (account_id, id) on delete set null (recount_document_id)
);

comment on table public.inventory_recount_moves is
  'Какие позиции и в какой акт пересчёта вынесены из исходного акта. Переживает переимпорт строк из Quick Resto.';

create index if not exists inventory_recount_moves_document_idx
  on public.inventory_recount_moves (account_id, document_id);
create index if not exists inventory_recount_moves_recount_document_idx
  on public.inventory_recount_moves (account_id, recount_document_id);

alter table public.inventory_recount_moves enable row level security;

-- Читают те же, кто видит акты (RLS на documents уже разграничивает по
-- заведению и правам). Запись — только server actions под service_role:
-- клиентский write закрыт так же, как в миграции 219.
drop policy if exists "inventory_recount_moves_select" on public.inventory_recount_moves;
create policy "inventory_recount_moves_select" on public.inventory_recount_moves
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = inventory_recount_moves.document_id
        and d.account_id = inventory_recount_moves.account_id
    )
  );

grant select on public.inventory_recount_moves to anon, authenticated;

-- 3) Событие журнала о выносе позиций.
alter table public.inventory_result_events
  drop constraint if exists inventory_result_events_event_type_check;

alter table public.inventory_result_events
  add constraint inventory_result_events_event_type_check check (
    event_type = any (array[
      'comment_updated',
      'exclude_enabled',
      'exclude_disabled',
      'persistent_exclusion_enabled',
      'persistent_exclusion_disabled',
      'resort_created',
      'resort_voided',
      'resort_recalculated',
      'results_finalized',
      'results_reopened',
      'results_refreshed',
      'results_recheck_drift',
      'recount_split',
      'suggestion_applied',
      'suggestion_dismissed',
      'recount_marked',
      'recount_unmarked',
      'returned_for_recount',
      'assignee_changed',
      'reviewer_changed',
      'draft_started',
      'submitted'
    ])
  );
