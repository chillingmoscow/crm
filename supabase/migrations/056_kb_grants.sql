-- ============================================================
-- 056_kb_grants.sql
-- Stage 8.0 — Knowledge Base: backfill table-level GRANTs.
--
-- Тот же gotcha, что описан в 047: ALTER DEFAULT PRIVILEGES — per-role,
-- и при пуше через `psql -U supabase_admin` (см. memory/self_hosted_supabase.md)
-- новые таблицы не подхватывают defaults. Дублируем явные GRANT.
-- ============================================================

grant select, insert, update, delete on
  public.kb_pages,
  public.kb_page_versions,
  public.kb_page_links,
  public.kb_page_attachments
to anon, authenticated;

-- KB-таблицы используют uuid PK — sequences не нужны, в отличие от
-- transactions.public_id (bigserial). Если в будущем добавим bigserial
-- (например, человекочитаемый номер страницы), сюда же добавить
-- grant usage, select on sequence ... .
