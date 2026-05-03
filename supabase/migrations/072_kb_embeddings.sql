-- ============================================================
-- 072_kb_embeddings.sql
-- Sprint B / Tier 2.2b — RAG «Спросить базу знаний».
--
-- Что делает:
--   1. Включает extension `vector` (pgvector 0.8 на self-hosted +
--      local Supabase — verified `select * from pg_available_extensions
--      where name='vector'` обоих).
--   2. Создаёт таблицу `kb_page_embeddings` — pivot страница ×
--      chunk → embedding-вектор. 1 страница = N chunks (по headings
--      / fallback по paragraph), каждый chunk — отдельная строка.
--   3. Permission `kb.ask_ai` (UUID …000059) — отдельное право
--      пользоваться RAG-поиском (опционально отделено от kb.use_ai
--      для будущей гранулярности; дефолт — те же роли).
--
-- Embeddings: SiliconFlow `BAAI/bge-m3` — 1024 dim, multilingual,
-- доступен из RU. Pipeline upsert'а — в src/lib/knowledge/embeddings.ts
-- (вызывается после kb_save_page асинхронно, не блокирует save).
--
-- pgvector index: HNSW (быстрый approximate-search). Для нашей
-- шкалы (~1000 страниц × ~5 chunks = 5000 векторов) IVFFlat был бы
-- overkill, HNSW даёт sub-ms cosine query.
--
-- Стоимость embedding: $0.01 per 1M tokens × ~500 tokens/chunk
-- × ~5 chunks/page = ~$0.025 per 1000 pages. Re-embed на каждый save.
-- ============================================================

-- ============================================================
-- 1. pgvector
-- ============================================================
create extension if not exists vector;

-- ============================================================
-- 2. Таблица kb_page_embeddings
-- ============================================================

create table public.kb_page_embeddings (
  id              bigserial primary key,
  page_id         uuid not null references public.kb_pages(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  chunk_index     integer not null,
  -- Сам текст chunk'а — для прямой подстановки в LLM-context.
  -- Без него пришлось бы реконструировать chunk заново при ответе.
  content_chunk   text not null,
  -- 1024 dim — точная размерность bge-m3 (см. SiliconFlow docs).
  embedding       vector(1024) not null,
  created_at      timestamptz not null default now(),

  constraint kb_page_embeddings_unique unique (page_id, chunk_index)
);

-- HNSW index для cosine-similarity search. Параметры default:
-- m=16, ef_construction=64 — хороши для ≤100K векторов. Operator
-- `<=>` = cosine distance (1 - cos_sim).
create index kb_page_embeddings_cosine_idx
  on public.kb_page_embeddings using hnsw (embedding vector_cosine_ops);

-- B-tree для tenant-isolation в WHERE-клаузе.
create index kb_page_embeddings_account_idx
  on public.kb_page_embeddings(account_id, page_id);

comment on table public.kb_page_embeddings is
  'Embeddings KB-страниц для RAG. 1 страница = N chunks (по headings). '
  'Re-embedded после каждого kb_save_page. SiliconFlow bge-m3, 1024 dim.';

-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.kb_page_embeddings enable row level security;

-- SELECT — только свой account. Read RLS защищает от cross-tenant
-- утечки контекста через RAG-ответ.
create policy "kb_page_embeddings_select" on public.kb_page_embeddings
  for select using (
    account_id = public.get_active_account_id()
  );

-- INSERT / UPDATE / DELETE — только если есть kb.create_pages
-- (фактически только server-pipeline после save'а вызовет это, не
-- юзер с UI). Дополнительно защищаем consistency: page_id должен
-- быть в active account.
create policy "kb_page_embeddings_write" on public.kb_page_embeddings
  for all using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.create_pages')
  ) with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.create_pages')
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_embeddings.page_id
         and kp.account_id = public.get_active_account_id()
    )
  );

grant select, insert, update, delete on public.kb_page_embeddings to authenticated;
grant usage, select on sequence public.kb_page_embeddings_id_seq to authenticated;

-- ============================================================
-- 4. RPC: kb_search_embeddings — top-K cosine search в active account
-- ============================================================
--
-- Wrapper over `<=>` cosine distance с tenant-isolation. Возвращает
-- chunk + page-meta для построения LLM-context. Используется
-- src/lib/knowledge/ai-rag.ts.
--
-- Возвращаем 1 - cosine_distance (= cosine similarity) для удобства,
-- порядок by similarity desc (топ ↑).
-- ============================================================

create or replace function public.kb_search_embeddings(
  p_query_embedding vector(1024),
  p_limit integer default 5
)
returns table (
  page_id        uuid,
  chunk_index    integer,
  content_chunk  text,
  page_title     text,
  page_slug      text,
  page_icon      text,
  page_icon_color text,
  similarity     real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.page_id,
    e.chunk_index,
    e.content_chunk,
    p.title       as page_title,
    p.slug        as page_slug,
    p.icon        as page_icon,
    p.icon_color  as page_icon_color,
    (1 - (e.embedding <=> p_query_embedding))::real as similarity
  from public.kb_page_embeddings e
  join public.kb_pages p
    on p.id = e.page_id
   and p.deleted_at is null
  where e.account_id = public.get_active_account_id()
  order by e.embedding <=> p_query_embedding
  limit greatest(1, least(p_limit, 20));
$$;

comment on function public.kb_search_embeddings(vector, integer) is
  'Top-K cosine-similar chunks из KB в active account. Возвращает '
  'chunk + page-meta. Используется RAG-action askKbAi.';

grant execute on function public.kb_search_embeddings(vector, integer) to authenticated;

-- ============================================================
-- 5. Permission `kb.ask_ai`
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000059',
   'kb.ask_ai',
   'Задавать вопросы базе знаний с AI-ответом (RAG)',
   'kb');

-- Дефолтная матрица — те же роли что и kb.use_ai. Hostess/waiter
-- НЕТ: даже read-only AI-доступ — это AI-расход на их вопросы. Если
-- захотим пускать всех — отдельным UPDATE role_permissions.
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000059'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000002'::uuid),  -- manager
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000006'::uuid)   -- accountant
) as r(role_id);
