import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import { ProfileSection } from "@/components/shared/profile-section";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { mediaUrl } from "@/lib/storage/media";
import {
  batchNetGrams,
  countConfigSchema,
  sectionNetGrams,
  weighingDraftSchema,
  type CountConfig,
  type WeighingDraft,
} from "@/lib/stock-count/tobacco-weighing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

import { WeighingRetryButton } from "./weighing-retry-button";

type CommitRow = {
  id: string;
  occurrence_id: string;
  status: "pending" | "processing" | "done" | "failed";
  last_error: string | null;
  telegram_status: "pending" | "sending" | "sent" | "failed" | "skipped";
};

type OccurrenceRow = {
  id: string;
  user_id: string | null;
  employee_name: string | null;
  business_date: string;
  submitted_at: string | null;
  snapshot: { count_config?: unknown } | null;
  answers: { weighing?: unknown } | null;
};

const grams = new Intl.NumberFormat("ru-RU");
const kg = (value: number) => `${(value / 1000).toFixed(3).replace(".", ",")} кг`;

const COMMIT_STATUS: Record<CommitRow["status"], { tone: StatusTone; label: string }> = {
  pending: { tone: "info", label: "Проводится" },
  processing: { tone: "info", label: "Проводится" },
  done: { tone: "success", label: "Проведён" },
  failed: { tone: "danger", label: "Ошибка проведения" },
};

const TELEGRAM_STATUS: Partial<Record<CommitRow["telegram_status"], string>> = {
  pending: "Отчёт отправляется в Telegram",
  sending: "Отчёт отправляется в Telegram",
  sent: "Отчёт отправлен в Telegram",
  failed: "Отчёт в Telegram не отправлен",
};

/**
 * Блок «Взвешивание» на вкладке «Основное» акта: партии, тара, нетто, фото,
 * кто и когда взвешивал, ссылка на задание и статус проведения. Показывается,
 * только если акт создан взвешиванием (есть строка очереди проведения).
 *
 * Видимость акта уже проверил layout карточки; очередь и задание читаются
 * служебным клиентом строго в пределах аккаунта. Фото — постоянными адресами
 * от имени пользователя: их видит тот, кому хранилище открывает задание
 * (исполнитель и управляющие графика), остальным показываем, что фото есть.
 */
export async function WeighingBlock({
  documentId,
  accountId,
  canRetry,
  timeZone,
}: {
  documentId: string;
  accountId: string;
  canRetry: boolean;
  timeZone: string | null;
}) {
  const admin = asLooseDb(createAdminClient());
  const { data: commit, error } = await admin
    .from<CommitRow>("stock_count_commits")
    .select("id, occurrence_id, status, last_error, telegram_status")
    .eq("account_id", accountId)
    .eq("document_id", documentId)
    .maybeSingle();
  // Нет очереди (акт не из взвешивания) или таблица ещё не создана — блока нет.
  if (error || !commit) return null;

  const { data: occurrence } = await admin
    .from<OccurrenceRow>("schedule_task_occurrences")
    .select("id, user_id, employee_name, business_date, submitted_at, snapshot, answers")
    .eq("account_id", accountId)
    .eq("id", commit.occurrence_id)
    .maybeSingle();
  if (!occurrence) return null;

  const config = countConfigSchema.safeParse(occurrence.snapshot?.count_config);
  const draft = weighingDraftSchema.safeParse(occurrence.answers?.weighing);

  const [performer, canSeePhotos] = await Promise.all([
    performerName(admin, occurrence),
    occurrenceVisible(occurrence.id),
  ]);

  const status = COMMIT_STATUS[commit.status];
  const telegram = commit.status === "done" ? TELEGRAM_STATUS[commit.telegram_status] : undefined;
  const now = new Date();
  const tz = timeZone ?? undefined;
  const startedAt = draft.success ? draft.data.startedAt : null;

  return (
    <ProfileSection title="Взвешивание">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {telegram ? <span className="text-[13px] text-muted-foreground">{telegram}</span> : null}
        </div>
        {commit.status === "failed" ? (
          <>
            <p className="break-words text-sm">{commit.last_error || "Причина не указана"}</p>
            {canRetry ? <WeighingRetryButton commitId={commit.id} /> : null}
          </>
        ) : null}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Item label="Взвешивал(а)" value={performer} />
        <Item label="Задание" value={formatDayMonth(occurrence.business_date, now, tz)}>
          <Link
            href={`/schedule?showTasks=1&date=${occurrence.business_date}`}
            className="text-sm text-brand hover:underline"
          >
            {`Задание на ${formatDayMonth(occurrence.business_date, now, tz)}`}
          </Link>
        </Item>
        <Item label="Начало" value={formatDayMonthTime(startedAt, now, tz)} />
        <Item label="Сдано" value={formatDayMonthTime(occurrence.submitted_at, now, tz)} />
      </dl>

      {config.success && draft.success ? (
        <Sections config={config.data} draft={draft.data} occurrenceId={occurrence.id} canSeePhotos={canSeePhotos} />
      ) : (
        <p className="text-sm text-muted-foreground">Данные взвешивания не читаются</p>
      )}
    </ProfileSection>
  );
}

function Sections({
  config,
  draft,
  occurrenceId,
  canSeePhotos,
}: {
  config: CountConfig;
  draft: WeighingDraft;
  occurrenceId: string;
  canSeePhotos: boolean;
}) {
  const photoPattern = new RegExp(`^${occurrenceId}/weighing/[^/]+$`);
  return (
    <div className="flex flex-col gap-4">
      {config.sections.map((section) => {
        const saved = draft.sections[section.key];
        const tareTitle = new Map(section.tares.map((tare) => [tare.key, tare]));
        return (
          <div key={section.key} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <span className="text-sm tabular-nums">
                {saved && !saved.empty ? `Нетто ${kg(sectionNetGrams(saved, section.tares))}` : "Ничего нет"}
              </span>
            </div>
            {saved && !saved.empty
              ? saved.batches.map((batch, index) => {
                  const tares = batch.tares
                    .filter((tare) => tare.count > 0)
                    .map((tare) => {
                      const known = tareTitle.get(tare.tareKey);
                      return `${known?.title ?? "Тара"} × ${tare.count}${known ? ` (${grams.format(known.grams * tare.count)} г)` : ""}`;
                    });
                  const photo = batch.photo && photoPattern.test(batch.photo) ? batch.photo : null;
                  return (
                    <div key={batch.id} className="flex min-w-0 items-start gap-3 border-t pt-2 first:border-t-0 first:pt-0">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px]">
                        <span className="font-medium">{`Партия ${index + 1}`}</span>
                        <span className="tabular-nums">{`Брутто ${grams.format(batch.grams)} г · нетто ${grams.format(batchNetGrams(batch, section.tares))} г`}</span>
                        <span className="break-words text-muted-foreground">
                          {tares.length > 0 ? `Тара: ${tares.join(", ")}` : "Без тары"}
                        </span>
                      </div>
                      {photo && canSeePhotos ? (
                        <a
                          href={mediaUrl("task-evidence", photo)}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0"
                          aria-label={`Фото: ${section.title}, партия ${index + 1}`}
                        >
                          <Image
                            src={mediaUrl("task-evidence", photo, { transform: { width: 192, height: 192, resize: "cover" } })}
                            alt={`Фото: ${section.title}, партия ${index + 1}`}
                            width={96}
                            height={96}
                            className="size-24 rounded-md object-cover"
                            unoptimized
                          />
                        </a>
                      ) : photo ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Фото есть</span>
                      ) : null}
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}
    </div>
  );
}

async function performerName(admin: ReturnType<typeof asLooseDb>, occurrence: OccurrenceRow): Promise<string | null> {
  if (occurrence.employee_name?.trim()) return occurrence.employee_name.trim();
  if (!occurrence.user_id) return null;
  const { data } = await admin
    .from<{ first_name: string | null; last_name: string | null }>("profiles")
    .select("first_name, last_name")
    .eq("id", occurrence.user_id)
    .maybeSingle();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

/** Видит ли пользователь задание — тогда хранилище отдаст ему и фото партий. */
async function occurrenceVisible(occurrenceId: string): Promise<boolean> {
  const supabase = asLooseDb(await createClient());
  const { data } = await supabase
    .from<{ id: string }>("schedule_task_occurrences")
    .select("id")
    .eq("id", occurrenceId)
    .maybeSingle();
  return Boolean(data?.id);
}

function Item({
  label,
  value,
  children,
}: {
  label: string;
  value: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {value === null ? <span className="text-muted-foreground">Не указано</span> : (children ?? value)}
      </dd>
    </div>
  );
}
