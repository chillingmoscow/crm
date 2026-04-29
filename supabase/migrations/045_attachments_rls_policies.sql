-- ============================================================
-- 045_attachments_rls_policies.sql
-- RLS для account_files + pivot-таблиц прикреплений + storage policies
-- для bucket account-attachments.
--
-- См. docs/MERGE_PLAN.md §4.4: «account_files — account_id + право в
-- зависимости от типа pivot'а», pivot RLS — через JOIN с родительской
-- сущностью.
-- ============================================================

-- ───────────────────────── account_files ─────────────────────────
alter table public.account_files enable row level security;

-- Видимость файла = у пользователя есть право видеть ХОТЯ БЫ ОДНУ
-- сущность, к которой этот файл прикреплён в текущем активном
-- account. Пока такое связывание есть только для transactions /
-- counterparties / legal_entities — все три проверяем.
create policy "account_files_select"
  on public.account_files for select
  using (
    account_id = public.get_active_account_id()
    and (
      -- Прикреплён к транзакции, которую видим.
      exists (
        select 1 from public.transaction_attachments ta
        join public.transactions t on t.id = ta.transaction_id
        where ta.file_id = account_files.id
          and t.account_id = public.get_active_account_id()
          and public.has_permission('finance.view_attachments')
      )
      -- Прикреплён к контрагенту, которого видим.
      or exists (
        select 1 from public.counterparty_attachments ca
        join public.counterparties c on c.id = ca.counterparty_id
        where ca.file_id = account_files.id
          and c.account_id = public.get_active_account_id()
          and public.has_permission('finance.view_attachments')
      )
      -- Прикреплён к юрлицу, которое видим.
      or exists (
        select 1 from public.legal_entity_attachments la
        join public.legal_entities le on le.id = la.legal_entity_id
        where la.file_id = account_files.id
          and le.account_id = public.get_active_account_id()
          and public.has_permission('org.view_legal_entities')
      )
      -- Только что загружено в текущей сессии (pivot-запись ещё не
      -- создана) — файл виден владельцу загрузки.
      or uploaded_by = auth.uid()
    )
  );

create policy "account_files_insert"
  on public.account_files for insert
  with check (
    account_id = public.get_active_account_id()
    and uploaded_by = auth.uid()
    and public.has_permission('finance.upload_attachments')
  );

create policy "account_files_delete"
  on public.account_files for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('finance.delete_attachments')
  );

-- ───────────────────────── transaction_attachments ─────────────────────────
alter table public.transaction_attachments enable row level security;

create policy "transaction_attachments_select"
  on public.transaction_attachments for select
  using (
    public.has_permission('finance.view_attachments')
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_attachments.transaction_id
        and t.account_id = public.get_active_account_id()
    )
  );

-- Файл, на который ссылается pivot, обязан принадлежать активному
-- account: FK-проверки в Postgres обходят RLS, и без этой проверки
-- пользователь мог бы прислать чужой file_id и связать с ним свою
-- транзакцию. То же — для counterparty/legal_entity-pivot ниже.
create policy "transaction_attachments_insert"
  on public.transaction_attachments for insert
  with check (
    public.has_permission('finance.upload_attachments')
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_attachments.transaction_id
        and t.account_id = public.get_active_account_id()
    )
    and exists (
      select 1 from public.account_files af
      where af.id = transaction_attachments.file_id
        and af.account_id = public.get_active_account_id()
    )
  );

create policy "transaction_attachments_delete"
  on public.transaction_attachments for delete
  using (
    public.has_permission('finance.delete_attachments')
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_attachments.transaction_id
        and t.account_id = public.get_active_account_id()
    )
  );

-- ───────────────────────── counterparty_attachments ─────────────────────────
alter table public.counterparty_attachments enable row level security;

create policy "counterparty_attachments_select"
  on public.counterparty_attachments for select
  using (
    public.has_permission('finance.view_attachments')
    and exists (
      select 1 from public.counterparties c
      where c.id = counterparty_attachments.counterparty_id
        and c.account_id = public.get_active_account_id()
    )
  );

create policy "counterparty_attachments_insert"
  on public.counterparty_attachments for insert
  with check (
    public.has_permission('finance.upload_attachments')
    and exists (
      select 1 from public.counterparties c
      where c.id = counterparty_attachments.counterparty_id
        and c.account_id = public.get_active_account_id()
    )
    and exists (
      select 1 from public.account_files af
      where af.id = counterparty_attachments.file_id
        and af.account_id = public.get_active_account_id()
    )
  );

create policy "counterparty_attachments_delete"
  on public.counterparty_attachments for delete
  using (
    public.has_permission('finance.delete_attachments')
    and exists (
      select 1 from public.counterparties c
      where c.id = counterparty_attachments.counterparty_id
        and c.account_id = public.get_active_account_id()
    )
  );

-- ───────────────────────── legal_entity_attachments ─────────────────────────
alter table public.legal_entity_attachments enable row level security;

create policy "legal_entity_attachments_select"
  on public.legal_entity_attachments for select
  using (
    public.has_permission('org.view_legal_entities')
    and exists (
      select 1 from public.legal_entities le
      where le.id = legal_entity_attachments.legal_entity_id
        and le.account_id = public.get_active_account_id()
    )
  );

create policy "legal_entity_attachments_insert"
  on public.legal_entity_attachments for insert
  with check (
    public.has_permission('org.manage_legal_entities')
    and exists (
      select 1 from public.legal_entities le
      where le.id = legal_entity_attachments.legal_entity_id
        and le.account_id = public.get_active_account_id()
    )
    and exists (
      select 1 from public.account_files af
      where af.id = legal_entity_attachments.file_id
        and af.account_id = public.get_active_account_id()
    )
  );

create policy "legal_entity_attachments_delete"
  on public.legal_entity_attachments for delete
  using (
    public.has_permission('org.manage_legal_entities')
    and exists (
      select 1 from public.legal_entities le
      where le.id = legal_entity_attachments.legal_entity_id
        and le.account_id = public.get_active_account_id()
    )
  );

-- ───────────────────────── storage.objects: account-attachments ─────────────
-- Объекты в bucket `account-attachments` лежат с префиксом UUID
-- account_id (storage_path шаблон: {account_id}/{yyyy}/{mm}/{uuid}-{name}).
--
-- SELECT/DELETE — авторизация делегирована RLS на account_files: объект
-- виден тогда и только тогда, когда у пользователя есть видимая строка
-- в account_files с этим storage_path. Тем самым доступ к storage не
-- может обойти проверку «прикреплён ли файл к сущности, которую я могу
-- видеть» (например, legal-entity файлы требуют org.view_legal_entities,
-- а не просто finance.view_attachments — см. account_files_select).
--
-- INSERT — на момент аплоада строка account_files может ещё не
-- существовать (стандартный flow: сначала upload в storage, потом
-- INSERT в account_files). Поэтому INSERT остаётся через префикс
-- папки + finance.upload_attachments. Cross-tenant запись отсекается
-- последующим INSERT в account_files (RLS требует совпадения
-- account_id с активным).

create policy "account_attachments_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'account-attachments'
    and exists (
      select 1 from public.account_files af
      where af.storage_path = name
    )
  );

create policy "account_attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'account-attachments'
    and (storage.foldername(name))[1] = public.get_active_account_id()::text
    and public.has_permission('finance.upload_attachments')
  );

create policy "account_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'account-attachments'
    and exists (
      select 1 from public.account_files af
      where af.storage_path = name
    )
    and public.has_permission('finance.delete_attachments')
  );
