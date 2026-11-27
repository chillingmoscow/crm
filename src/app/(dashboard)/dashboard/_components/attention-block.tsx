import Link from "next/link";
import {
  AlertCircle,
  Banknote,
  CalendarX2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  RefreshCw,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAttentionItems, type AttentionItem, type AttentionKind } from "@/lib/home/attention";
import { cn } from "@/lib/utils";

import { HomeSection } from "./section";

const ICON: Record<AttentionKind, LucideIcon> = {
  quickresto_sync: RefreshCw,
  finance_inbox: AlertCircle,
  unassigned_shifts: CalendarX2,
  attendance: ClipboardCheck,
  candidates: UserPlus,
  inventory_acts: ClipboardList,
  payout_plan: Banknote,
};

/** Подложка значка — тона `StatusBadge` (DS → «Статусные бейджи»). */
const TONE: Record<AttentionItem["tone"], string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  info: "bg-brand/10 text-brand",
  neutral: "bg-muted text-muted-foreground",
};

/** Что не удалось проверить — словами, без технических названий. */
const FAILED_LABEL: Record<AttentionKind, string> = {
  quickresto_sync: "синхронизацию с Quick Resto",
  finance_inbox: "платежи на разбор",
  unassigned_shifts: "смены без сотрудника",
  attendance: "отметки",
  candidates: "анкеты кандидатов",
  inventory_acts: "акты инвентаризации",
  payout_plan: "план выплат",
};

/**
 * «Требует внимания»: одна очередь дел из разных разделов, у каждого пункта
 * своя кнопка — куда идти. Пустая очередь — спокойное «Всё в порядке».
 * Источник, который не ответил, не прячется молча: под очередью строка
 * «Не удалось проверить: …», чтобы пустота не выдавала себя за порядок.
 */
export async function AttentionBlock() {
  const { items, failed } = await getAttentionItems();
  return (
    <HomeSection title={items.length ? `Требует внимания · ${items.length}` : "Требует внимания"}>
      {items.length ? (
        <ul className="-mx-2 divide-y">
          {items.map((item, i) => {
            const Icon = ICON[item.kind];
            return (
              <li
                key={item.kind}
                className="table-row-in flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3 first:pt-0 last:pb-0 sm:flex-nowrap"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", TONE[item.tone])}>
                  <Icon className="size-4" aria-hidden />
                </span>
                {/* На телефоне кнопка уходит под текст, чтобы не сжимать его в столбик. */}
                <span className="min-w-0 flex-1 basis-[calc(100%-48px)] sm:basis-auto">
                  <span className="block text-sm font-medium">{item.title}</span>
                  {item.detail ? (
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  ) : null}
                </span>
                <Button asChild variant="outline" size="sm" className="ml-12 shrink-0 sm:ml-0">
                  <Link href={item.href}>{item.action}</Link>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : failed.length ? null : (
        <div className="flex items-center gap-3 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Всё в порядке</span>
            <span className="block text-xs text-muted-foreground">Срочных дел нет</span>
          </span>
        </div>
      )}
      {failed.length ? (
        <p role="status" className={cn("text-xs text-muted-foreground", items.length && "mt-4")}>
          Не удалось проверить: {failed.map((kind) => FAILED_LABEL[kind]).join(", ")}. Обновите страницу позже.
        </p>
      ) : null}
    </HomeSection>
  );
}
