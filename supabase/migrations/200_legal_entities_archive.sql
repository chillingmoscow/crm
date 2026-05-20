-- ============================================================
-- 200_legal_entities_archive.sql
-- Pass B2 жизненного цикла удаления (docs/CONVENTIONS.md §2):
-- юрлица переезжают с is_active boolean на archived_at + archived_by.
-- Этот столбец antipattern — is_active теряет timestamp/by, не вяжется
-- с конвенцией.
--
-- Шаги:
--   1) Добавить archived_at + archived_by.
--   2) Backfill: для строк с is_active=false ставим archived_at =
--      coalesce(updated_at, created_at) — лучшая доступная оценка.
--   3) RLS *_select: добавляем archived_at IS NULL для обычной видимости,
--      + *_select_archived_owner для архив-страницы (owner-only).
--   4) Audit-триггер legal_entities_audit_trigger (156) — переписать
--      ветви archived/restored с триггера is_active toggle на переход
--      archived_at NULL ↔ NOT NULL; DELETE ветвь остаётся.
--   5) Drop column is_active (последним, после переписи RLS+триггера +
--      backfill, чтобы не было окна рассинхрона).
--
-- Permission org.delete_legal_entity уже существует с миграции 034 и
-- owner-only — не трогаем. Hard-delete остаётся возможен только при
-- отсутствии RESTRICT-блокеров (bank_accounts, transactions, venues
-- ON DELETE RESTRICT — миграции 036/040/053). UI скрывает «Удалить
-- навсегда» с пояснением, что эта сущность — archive-only.
-- ============================================================

-- ── 1. Колонки ────────────────────────────────────────────────
alter table public.legal_entities
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null
    references public.profiles(id) on delete set null;

comment on column public.legal_entities.archived_at is
  'Soft-archive: NOT NULL — юрлицо скрыто из живых списков и выборов. '
  'Видно только в /org/legal-entities/archive у owner''а. Восстановление — NULL.';
comment on column public.legal_entities.archived_by is
  'Кто архивировал. SET NULL при удалении профиля.';

-- ── 2. Backfill из is_active ──────────────────────────────────
-- Для существующих рядов с is_active=false ставим archived_at = время
-- последнего изменения (или создания если updated_at пустой).
update public.legal_entities
   set archived_at = coalesce(updated_at, created_at)
 where is_active = false
   and archived_at is null;

-- partial index ускоряет дефолтный фильтр archived_at IS NULL
create index if not exists legal_entities_account_active_idx
  on public.legal_entities (account_id)
  where archived_at is null;

-- ── 3. RLS ────────────────────────────────────────────────────
-- legal_entities_select: только live для всех. Архивные приходят
-- через *_select_archived_owner (PERMISSIVE → OR). Disjoint policies
-- по archived_at — допустимый multiple_permissive_policies advisor.
drop policy if exists "legal_entities_select" on public.legal_entities;
create policy "legal_entities_select" on public.legal_entities
  for select
  using (
    archived_at is null
    and account_id = get_active_account_id()
    and has_permission('org.view_legal_entities')
  );

create policy "legal_entities_select_archived_owner" on public.legal_entities
  for select
  using (
    archived_at is not null
    and is_account_owner(account_id)
  );

-- ── 4. Audit-триггер: archived_at вместо is_active ────────────
-- Переписываем ветви UPDATE-toggle с is_active на archived_at-переходы.
-- DELETE-ветвь, INSERT-ветвь и diff-полей не меняем.
create or replace function public.legal_entities_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_account_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_account_id := OLD.account_id;
  else
    v_account_id := NEW.account_id;
  end if;
  if v_account_id is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'name',       NEW.name,
      'legal_form', NEW.legal_form,
      'inn',        NEW.inn
    );
    perform public.log_audit_with_context(
      'legal_entity.created', 'legal_entity', NEW.id, v_payload,
      v_account_id, auth.uid(), null, NEW.id
    );
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object(
      'name',       OLD.name,
      'legal_form', OLD.legal_form,
      'inn',        OLD.inn
    );
    begin
      perform public.log_audit_with_context(
        'legal_entity.deleted', 'legal_entity', OLD.id, v_payload,
        v_account_id, auth.uid(), null, null
      );
    exception
      when foreign_key_violation then
        -- account cascade-delete (см. venues_audit_trigger §DELETE).
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    -- archive / restore переходы — отдельные события вместо diff
    if OLD.archived_at is null and NEW.archived_at is not null then
      perform public.log_audit_with_context(
        'legal_entity.archived', 'legal_entity', NEW.id,
        jsonb_build_object('name', NEW.name, 'inn', NEW.inn, 'archived_by', NEW.archived_by),
        v_account_id, auth.uid(), null, NEW.id
      );
      return NEW;
    end if;
    if OLD.archived_at is not null and NEW.archived_at is null then
      perform public.log_audit_with_context(
        'legal_entity.restored', 'legal_entity', NEW.id,
        jsonb_build_object('name', NEW.name, 'inn', NEW.inn),
        v_account_id, auth.uid(), null, NEW.id
      );
      return NEW;
    end if;

    -- Diff значимых полей (оставлено из миграции 156)
    if OLD.name is distinct from NEW.name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'name', 'old', OLD.name, 'new', NEW.name
      ));
    end if;
    if OLD.short_name is distinct from NEW.short_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'short_name', 'old', OLD.short_name, 'new', NEW.short_name
      ));
    end if;
    if OLD.legal_form is distinct from NEW.legal_form then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'legal_form', 'old', OLD.legal_form, 'new', NEW.legal_form
      ));
    end if;
    if OLD.inn is distinct from NEW.inn then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'inn', 'old', OLD.inn, 'new', NEW.inn
      ));
    end if;
    if OLD.kpp is distinct from NEW.kpp then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'kpp', 'old', OLD.kpp, 'new', NEW.kpp
      ));
    end if;
    if OLD.ogrn is distinct from NEW.ogrn then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'ogrn', 'old', OLD.ogrn, 'new', NEW.ogrn
      ));
    end if;
    if OLD.okpo is distinct from NEW.okpo then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'okpo', 'old', OLD.okpo, 'new', NEW.okpo
      ));
    end if;
    if OLD.okved is distinct from NEW.okved then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'okved', 'old', OLD.okved, 'new', NEW.okved
      ));
    end if;
    if OLD.tax_system is distinct from NEW.tax_system then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'tax_system', 'old', OLD.tax_system, 'new', NEW.tax_system
      ));
    end if;
    if OLD.vat_payer is distinct from NEW.vat_payer then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'vat_payer', 'old', OLD.vat_payer, 'new', NEW.vat_payer
      ));
    end if;
    if OLD.legal_address is distinct from NEW.legal_address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'legal_address', 'old', OLD.legal_address, 'new', NEW.legal_address
      ));
    end if;
    if OLD.actual_address is distinct from NEW.actual_address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'actual_address', 'old', OLD.actual_address, 'new', NEW.actual_address
      ));
    end if;
    if OLD.postal_address is distinct from NEW.postal_address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'postal_address', 'old', OLD.postal_address, 'new', NEW.postal_address
      ));
    end if;
    if OLD.director_name is distinct from NEW.director_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'director_name', 'old', OLD.director_name, 'new', NEW.director_name
      ));
    end if;
    if OLD.director_position is distinct from NEW.director_position then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'director_position', 'old', OLD.director_position, 'new', NEW.director_position
      ));
    end if;
    if OLD.accountant_name is distinct from NEW.accountant_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'accountant_name', 'old', OLD.accountant_name, 'new', NEW.accountant_name
      ));
    end if;
    if OLD.signature_basis is distinct from NEW.signature_basis then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'signature_basis', 'old', OLD.signature_basis, 'new', NEW.signature_basis
      ));
    end if;
    if OLD.phone is distinct from NEW.phone then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'phone', 'old', OLD.phone, 'new', NEW.phone
      ));
    end if;
    if OLD.email is distinct from NEW.email then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'email', 'old', OLD.email, 'new', NEW.email
      ));
    end if;
    if OLD.website is distinct from NEW.website then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'website', 'old', OLD.website, 'new', NEW.website
      ));
    end if;
    if OLD.default_bank_name is distinct from NEW.default_bank_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_bank_name', 'old', OLD.default_bank_name, 'new', NEW.default_bank_name
      ));
    end if;
    if OLD.default_bik is distinct from NEW.default_bik then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_bik', 'old', OLD.default_bik, 'new', NEW.default_bik
      ));
    end if;
    if OLD.default_account_number is distinct from NEW.default_account_number then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_account_number', 'old', OLD.default_account_number, 'new', NEW.default_account_number
      ));
    end if;
    if OLD.default_corr_account is distinct from NEW.default_corr_account then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_corr_account', 'old', OLD.default_corr_account, 'new', NEW.default_corr_account
      ));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object(
        'name',    NEW.name,
        'changes', v_changes
      );
      perform public.log_audit_with_context(
        'legal_entity.updated', 'legal_entity', NEW.id, v_payload,
        v_account_id, auth.uid(), null, NEW.id
      );
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.legal_entities_audit_trigger() is
  'Audit-trail для public.legal_entities: created / updated (diff) / '
  'archived (soft) / restored / deleted (hard). archived/restored — '
  'переходы archived_at вместо is_active (миграция 200).';

-- ── 5. Drop column is_active ──────────────────────────────────
-- Делаем последним. К этому моменту:
--   - RLS уже использует archived_at, не is_active.
--   - Триггер уже не читает is_active.
--   - Application-код потребует обновления (отдельный коммит, но
--     RLS+триггер уже совместимы — drop безопасен).
-- Codex pre-flight: код может ссылаться на is_active в insert/update
-- payload'ах. Проверено перед миграцией — есть в createLegalEntity
-- (init = true), deactivateLegalEntity (set false), listActive
-- (.eq('is_active', true)). Эти вызовы переписаны на archived_at в
-- этом же PR (src/lib/org/legal-entities.ts).
alter table public.legal_entities drop column is_active;
