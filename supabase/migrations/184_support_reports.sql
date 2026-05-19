-- 184_support_reports.sql
--
-- Инструмент «Сообщить об ошибке / поддержка»: пользователь шлёт репорт
-- с опциональным вложением. Файлы — в приватный bucket
-- `support-attachments`; в GitHub-issue / письмо разработчику попадает
-- подписанная ссылка (минтится серверно). `support_reports` — лёгкий
-- audit/rate-limit log без admin-UI.

-- ─── Storage bucket (приватный) ───────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'support-attachments',
    'support-attachments',
    false,
    52428800, -- 50 MiB, совпадает со storage.file_size_limit в config.toml
    array[
      'image/png','image/jpeg','image/gif','image/webp',
      'video/mp4','video/webm','video/quicktime',
      'application/pdf'
    ]
  )
  on conflict (id) do nothing;

-- INSERT: только под своим префиксом `${auth.uid()}/...`. Публичного
-- SELECT нет — ссылку на файл выдаёт сервер (service-role admin-клиент,
-- который обходит RLS). SELECT-own оставлен, чтобы загрузивший мог
-- перевыпустить ссылку при необходимости.
-- Никаких policy на storage.objects для этого бакета НЕТ намеренно.
-- Аплоад и выдача signed URL идут ТОЛЬКО серверно через service-role
-- (createAdminClient), уже после rate-limit проверки в submitSupportReport.
-- Публичный INSERT-policy открыл бы прямой неметрируемый аплоад в обход
-- лимита 10/час (Codex P2). Bucket приватный → без policy authenticated
-- юзер не имеет доступа, service-role обходит RLS.

-- ─── Audit log + rate-limit + восстановление при сбое доставки ─────────────
create table public.support_reports (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  account_id       uuid,
  category         text        not null,
  description      text        not null,
  page_url         text,
  attachment_path  text,
  github_issue_url text,
  created_at       timestamptz not null default now()
);

alter table public.support_reports enable row level security;

create policy "support_reports_insert_own"
  on public.support_reports for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "support_reports_select_own"
  on public.support_reports for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Покрывает rate-limit запрос «сколько репортов у юзера за последний час».
create index support_reports_user_created_idx
  on public.support_reports (user_id, created_at desc);

comment on table public.support_reports is
  'Audit/rate-limit log репортов из формы «Помощь и поддержка». '
  'Хранит содержание (description/page_url/attachment_path), чтобы репорт '
  'можно было восстановить, если оба канала доставки (GitHub+email) упали.';
