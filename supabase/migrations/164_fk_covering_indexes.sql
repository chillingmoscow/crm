-- ============================================================
-- 164_fk_covering_indexes.sql
--
-- Закрывает выборочные `unindexed_foreign_keys` advisor warnings
-- (Wave 3 performance cleanup).
--
-- Стратегия: индексируем только FK, которые реально участвуют в
-- запросах приложения (tenant-композитные FK, joined-на-каждый-запрос
-- FK), и пропускаем "аудит"-FK (`created_by`, `updated_by`, `deleted_by`,
-- `invited_by`, `attached_by`, и т.п.) — там write-overhead не оправдан
-- редким использованием.
--
-- Плоские `create index if not exists` — идемпотентно, безопасно при
-- повторе. Без CONCURRENTLY: миграции Supabase прогоняются в одной
-- транзакции, а CONCURRENTLY вне транзакции — на наших размерах таблиц
-- lock-time миллисекунды, регресса не будет.
-- ============================================================

-- ── Tier A: tenant-композитные FK (account_id, X) ──────────────
-- Все references на UNIQUE (account_id, id) родителя. Composite-индекс
-- обязателен для эффективного cascade delete/update и для JOIN-планов.
-- Существующие single-column индексы (например `transactions_bank_account_idx`)
-- не покрывают композитный FK lookup.

create index if not exists bank_accounts_account_legal_entity_idx
  on public.bank_accounts (account_id, legal_entity_id);
create index if not exists bank_accounts_account_venue_idx
  on public.bank_accounts (account_id, venue_id);

create index if not exists kb_page_links_account_from_page_idx
  on public.kb_page_links (account_id, from_page_id);
create index if not exists kb_page_links_account_to_page_idx
  on public.kb_page_links (account_id, to_page_id);

create index if not exists kb_page_versions_account_page_idx
  on public.kb_page_versions (account_id, page_id);

create index if not exists transactions_account_bank_account_idx
  on public.transactions (account_id, bank_account_id);
create index if not exists transactions_account_to_bank_account_idx
  on public.transactions (account_id, to_bank_account_id);
create index if not exists transactions_account_legal_entity_idx
  on public.transactions (account_id, legal_entity_id);
create index if not exists transactions_account_to_legal_entity_idx
  on public.transactions (account_id, to_legal_entity_id);
create index if not exists transactions_account_category_idx
  on public.transactions (account_id, category_id);
create index if not exists transactions_account_counterparty_idx
  on public.transactions (account_id, counterparty_id);
create index if not exists transactions_account_venue_idx
  on public.transactions (account_id, venue_id);

create index if not exists venues_account_default_legal_entity_idx
  on public.venues (account_id, default_legal_entity_id);


-- ── Tier B: hot-path single-column FK ──────────────────────────
-- FK, которые встречаются в JOIN-ах user-facing flow'ов или участвуют
-- в cascade delete крупных детских таблиц.

-- accounts.owner_id — "мои аккаунты" lookup, дашборд auth-флоу
create index if not exists accounts_owner_id_idx
  on public.accounts (owner_id);

-- profiles.active_venue_id — joined в permission checks на каждый request
create index if not exists profiles_active_venue_id_idx
  on public.profiles (active_venue_id)
  where active_venue_id is not null;

-- roles.account_id — list of account-scoped roles, частый scan
create index if not exists roles_account_id_idx
  on public.roles (account_id)
  where account_id is not null;

-- user_venue_roles.role_id — JOIN к roles в RLS-политиках
create index if not exists user_venue_roles_role_id_idx
  on public.user_venue_roles (role_id);

-- invitations.role_id — JOIN к roles на pending-invites view
create index if not exists invitations_role_id_idx
  on public.invitations (role_id);

-- departments.head_role_id — JOIN к roles для отображения руководителя
create index if not exists departments_head_role_id_idx
  on public.departments (head_role_id)
  where head_role_id is not null;

-- kb_threads.account_id — list threads для tenant, основной scan
create index if not exists kb_threads_account_id_idx
  on public.kb_threads (account_id);

-- kb_user_favorites.account_id — cascade delete + tenant filter
create index if not exists kb_user_favorites_account_id_idx
  on public.kb_user_favorites (account_id);

-- kb_user_favorites.page_id — cascade delete page → favorites
create index if not exists kb_user_favorites_page_id_idx
  on public.kb_user_favorites (page_id);

-- kb_page_reads.page_id — cascade delete page → reads, частая колонка
create index if not exists kb_page_reads_page_id_idx
  on public.kb_page_reads (page_id);

-- kb_comments.author_id — фильтр "мои комментарии"
create index if not exists kb_comments_author_id_idx
  on public.kb_comments (author_id);

-- notifications.venue_id — venue-scope фильтр уведомлений
create index if not exists notifications_venue_id_idx
  on public.notifications (venue_id)
  where venue_id is not null;
