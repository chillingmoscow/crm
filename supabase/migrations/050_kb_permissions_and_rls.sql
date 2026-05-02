-- ============================================================
-- 050_kb_permissions_and_rls.sql
-- Stage 8.0 — Knowledge Base: новые permission codes + RLS-политики.
--
-- Новый namespace `kb.*` (6 кодов). Дефолтная матрица ролей:
--   owner / admin       — все 6
--   manager / accountant — view + create + edit_own + manage_attachments
--   hostess / waiter    — только view
--
-- См. ~/.claude/plans/imperative-swinging-sparrow.md §2.3.
-- См. supabase/migrations/042_finance_rls_policies.sql и
--     supabase/migrations/046_soft_delete_visibility.sql — образцы.
-- ============================================================

-- ============================================================
-- 1. Новые permission codes (продолжение нумерации после 048).
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000049', 'kb.view_pages',          'Видеть базу знаний и читать страницы',    'kb'),
  ('10000000-0000-0000-0000-000000000050', 'kb.create_pages',        'Создавать страницы',                      'kb'),
  ('10000000-0000-0000-0000-000000000051', 'kb.edit_own_pages',      'Редактировать свои страницы',             'kb'),
  ('10000000-0000-0000-0000-000000000052', 'kb.edit_any_page',       'Редактировать любые страницы',            'kb'),
  ('10000000-0000-0000-0000-000000000053', 'kb.delete_pages',        'Удалять/восстанавливать страницы (soft)', 'kb'),
  ('10000000-0000-0000-0000-000000000054', 'kb.manage_attachments',  'Прикреплять/удалять файлы внутри страниц','kb');

-- ============================================================
-- 2. Дефолтная матрица role_permissions (как в 034 §5).
-- ============================================================

-- 2.1 Owner — все 6.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000001', p.id, true
from public.permissions p
where p.module = 'kb';

-- 2.2 Admin — все 6.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000003', p.id, true
from public.permissions p
where p.module = 'kb';

-- 2.3 Manager — view + create + edit_own + manage_attachments.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000002', p.id, true
from public.permissions p
where p.code in (
  'kb.view_pages',
  'kb.create_pages',
  'kb.edit_own_pages',
  'kb.manage_attachments'
);

-- 2.4 Accountant — view + create + edit_own + manage_attachments.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000006', p.id, true
from public.permissions p
where p.code in (
  'kb.view_pages',
  'kb.create_pages',
  'kb.edit_own_pages',
  'kb.manage_attachments'
);

-- 2.5 Hostess — только view.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000004', p.id, true
from public.permissions p
where p.code = 'kb.view_pages';

-- 2.6 Waiter — только view.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000005', p.id, true
from public.permissions p
where p.code = 'kb.view_pages';

-- ============================================================
-- 3. RLS на kb_pages.
-- Базовый паттерн из 042 / 046:
--   select  — account_id + view + (deleted_at is null OR delete_perm)
--   insert  — account_id + create
--   update  — account_id + (edit_any OR (edit_own AND created_by = uid))
--             ИЛИ delete_pages (для soft-delete: установка deleted_at)
--   delete  — запрещено (только soft через update); политики delete нет
-- ============================================================

alter table public.kb_pages enable row level security;

create policy "kb_pages_select"
  on public.kb_pages for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
    and (
      deleted_at is null
      or public.has_permission('kb.delete_pages')
    )
  );

create policy "kb_pages_insert"
  on public.kb_pages for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.create_pages')
  );

-- UPDATE покрывает три кейса: правка контента, soft-delete, restore.
-- Все три гейтятся на уровне server action — RLS лишь не пропускает
-- чужой account и пользователей без любого write-права.
create policy "kb_pages_update"
  on public.kb_pages for update
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('kb.edit_any_page')
      or (
        public.has_permission('kb.edit_own_pages')
        and created_by = auth.uid()
      )
      or public.has_permission('kb.delete_pages')
    )
  )
  with check (
    account_id = public.get_active_account_id()
  );

-- Hard-delete не разрешаем никому. Корзина на 30 дней + ручной purge
-- админом — сделаем отдельным cron'ом / server action позже.
-- (Намеренно отсутствует политика for delete.)

-- ============================================================
-- 4. RLS на kb_page_versions.
-- Видимость = видимость родительской страницы. Запись создаётся
-- триггером / server action'ом savePage. Прямые insert/update/delete
-- из клиента запрещены.
-- ============================================================

alter table public.kb_page_versions enable row level security;

create policy "kb_page_versions_select"
  on public.kb_page_versions for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
    and exists (
      select 1 from public.kb_pages p
      where p.id = kb_page_versions.page_id
        and p.account_id = public.get_active_account_id()
    )
  );

create policy "kb_page_versions_insert"
  on public.kb_page_versions for insert
  with check (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('kb.edit_any_page')
      or public.has_permission('kb.edit_own_pages')
    )
  );

-- update / delete намеренно не разрешены: версии иммутабельны.

-- ============================================================
-- 5. RLS на kb_page_links.
-- Записи пишутся server action'ом при сохранении страницы.
-- Видимость — у читателей KB.
-- ============================================================

alter table public.kb_page_links enable row level security;

create policy "kb_page_links_select"
  on public.kb_page_links for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
  );

create policy "kb_page_links_write"
  on public.kb_page_links for all
  using (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('kb.edit_any_page')
      or public.has_permission('kb.edit_own_pages')
    )
  )
  with check (
    account_id = public.get_active_account_id()
    and (
      public.has_permission('kb.edit_any_page')
      or public.has_permission('kb.edit_own_pages')
    )
  );

-- ============================================================
-- 6. RLS на kb_page_attachments.
-- Видимость и запись = доступ к родительской странице + соответствующее
-- attachment-право.
-- ============================================================

alter table public.kb_page_attachments enable row level security;

create policy "kb_page_attachments_select"
  on public.kb_page_attachments for select
  using (
    public.has_permission('kb.view_pages')
    and exists (
      select 1 from public.kb_pages p
      where p.id = kb_page_attachments.page_id
        and p.account_id = public.get_active_account_id()
    )
  );

create policy "kb_page_attachments_insert"
  on public.kb_page_attachments for insert
  with check (
    public.has_permission('kb.manage_attachments')
    and exists (
      select 1 from public.kb_pages p
      where p.id = kb_page_attachments.page_id
        and p.account_id = public.get_active_account_id()
    )
  );

create policy "kb_page_attachments_delete"
  on public.kb_page_attachments for delete
  using (
    public.has_permission('kb.manage_attachments')
    and exists (
      select 1 from public.kb_pages p
      where p.id = kb_page_attachments.page_id
        and p.account_id = public.get_active_account_id()
    )
  );

-- ============================================================
-- 7. Расширяем account_files SELECT-политику новой веткой:
-- файл виден, если он прикреплён к видимой странице БЗ.
-- (Текущая политика учитывает только transactions / counterparties /
--  legal_entities — см. 045.)
-- ============================================================

drop policy if exists "account_files_select" on public.account_files;
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
      -- Прикреплён к странице БЗ, которую видим.
      or exists (
        select 1 from public.kb_page_attachments pa
        join public.kb_pages kp on kp.id = pa.page_id
        where pa.file_id = account_files.id
          and kp.account_id = public.get_active_account_id()
          and public.has_permission('kb.view_pages')
      )
      -- Только что загружено в текущей сессии (pivot ещё не создан).
      or uploaded_by = auth.uid()
    )
  );

-- account_files insert/update/delete политики не трогаем — остаются из 045.
-- Загрузка вложения для страницы БЗ должна идти через server action,
-- который проверит kb.manage_attachments перед вставкой в account_files.
-- Поэтому также добавляем альтернативную INSERT-политику, разрешающую
-- загрузку под kb.manage_attachments:

drop policy if exists "account_files_insert" on public.account_files;
create policy "account_files_insert"
  on public.account_files for insert
  with check (
    account_id = public.get_active_account_id()
    and uploaded_by = auth.uid()
    and (
      public.has_permission('finance.upload_attachments')
      or public.has_permission('kb.manage_attachments')
    )
  );
