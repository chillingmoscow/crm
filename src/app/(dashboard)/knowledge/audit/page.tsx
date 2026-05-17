import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { isToday, isYesterday } from "date-fns";

import { createClient } from "@/lib/supabase/server";
import { listKbAuditEvents, getKbAuditCounts } from "@/lib/knowledge/audit";
import {
  kbAuditActionCodes,
  type KbAuditCountKey,
} from "@/lib/knowledge/audit-kinds";
import type { KbAuditEvent } from "@/lib/knowledge/audit";
import { EmptyState } from "@/components/ui/empty-state";
import { KbSectionHeader } from "@/app/(dashboard)/knowledge/_components/kb-section-header";
import { KbAuditEventRow } from "@/app/(dashboard)/knowledge/audit/_components/kb-audit-event-row";
import { KbAuditFilterChips } from "@/app/(dashboard)/knowledge/audit/_components/kb-audit-filter-chips";

/**
 * Журнал KB-audit-событий. Доступ — `org.view_audit` (та же permission,
 * что для общего audit_logs; миграция 035 §RLS).
 *
 * Фильтр по типу события — `?kind=created|deleted|moved` (чипы,
 * дизайн sheerly `gd7E2`). Без `kind` — все события. Смена фильтра
 * сбрасывает keyset-курсор.
 *
 * Pagination — keyset через композитный курсор `?before_at=...&before_id=...`
 * (cascade-операции вставляют десятки rows с одинаковым created_at —
 * простой `lt(created_at)` пропускал бы остальные; см. Codex #52 P1).
 * Курсор сосуществует с `kind` в ссылке «Старее».
 */
export default async function KbAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    before_at?: string;
    before_id?: string;
  }>;
}) {
  const {
    kind,
    before_at: beforeCreatedAt,
    before_id: beforeId,
  } = await searchParams;
  const supabase = await createClient();
  const [{ data: canView }, { data: canRestore }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "org.view_audit" }),
    supabase.rpc("has_permission", { permission_code: "kb.delete_pages" }),
  ]);
  if (!canView) redirect("/knowledge");

  const actionCodes = kbAuditActionCodes(kind);
  const currentKind: KbAuditCountKey = actionCodes
    ? (kind as KbAuditCountKey)
    : "all";

  const [{ events, hasMore, error }, counts] = await Promise.all([
    listKbAuditEvents({ actionCodes, beforeCreatedAt, beforeId }),
    getKbAuditCounts(),
  ]);

  const groups = groupByDay(events);

  // Ссылка «старее» сохраняет активный фильтр.
  const kindQS = currentKind === "all" ? "" : `kind=${currentKind}&`;
  const last = events[events.length - 1];
  const olderHref = last
    ? `/knowledge/audit?${kindQS}before_at=${encodeURIComponent(
        last.created_at,
      )}&before_id=${encodeURIComponent(last.id)}`
    : null;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 md:px-8 pt-4 pb-8 w-full">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-6">
          <KbSectionHeader
            title="Журнал изменений"
            description="Создание, переименование, перемещение и удаление страниц. Правки контента видны через «Историю версий» на самой странице."
          />

          <KbAuditFilterChips current={currentKind} counts={counts} />

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить журнал: {error}
            </div>
          )}

          {!error && events.length === 0 && !beforeCreatedAt && (
            <EmptyState
              icon={ScrollText}
              title={
                currentKind === "all"
                  ? "Пока пусто"
                  : "Нет событий этого типа"
              }
              description={
                currentKind === "all"
                  ? "Сюда будут попадать события: создание, переименование, перемещение и удаление KB-страниц."
                  : "По выбранному фильтру событий нет. Выберите другую категорию."
              }
            />
          )}

          {!error &&
            groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-2">
                <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {group.label} · {group.events.length}{" "}
                  {eventWord(group.events.length)}
                </h2>
                <ul className="flex flex-col rounded-xl border bg-card overflow-hidden">
                  {group.events.map((event) => (
                    <KbAuditEventRow
                      key={event.id}
                      event={event}
                      canRestore={Boolean(canRestore)}
                    />
                  ))}
                </ul>
              </section>
            ))}

          {hasMore && olderHref && (
            <div className="flex justify-center pt-2">
              <a
                href={olderHref}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Показать события старее →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

interface DayGroup {
  key: string;
  label: string;
  events: KbAuditEvent[];
}

/** Группирует уже-отсортированные (desc) события по дню удаления:
 *  Сегодня / Вчера / «D месяц YYYY». Порядок групп = порядок
 *  появления (события уже идут от новых к старым). */
function groupByDay(events: KbAuditEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const e of events) {
    const d = new Date(e.created_at);
    // Локальная календарная дата как ключ — чтобы совпадала с
    // меткой (isToday/isYesterday/toLocaleDateString тоже локальные).
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayLabel(d), events: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.events.push(e);
  }
  return groups;
}

function dayLabel(d: Date): string {
  if (isToday(d)) return "Сегодня";
  if (isYesterday(d)) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** RU-склонение слова «событие» по числу. */
function eventWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "событий";
  if (mod10 === 1) return "событие";
  if (mod10 >= 2 && mod10 <= 4) return "события";
  return "событий";
}
