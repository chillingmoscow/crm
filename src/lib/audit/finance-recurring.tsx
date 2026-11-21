import {
  Archive,
  CalendarClock,
  CalendarPlus,
  CheckCheck,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SkipForward,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import { ChangeLines } from "./change-lines";
import type { AuditEventSpec } from "./format";

// Повторяющиеся платежи «Финансов»: шаблоны и разбор ожидаемых платежей.
// Пишут server actions через writeAuditEvent (src/lib/finance/recurring.ts).

const INFO = "text-brand bg-brand/10";
const DANGER = "text-destructive bg-destructive/10";
const NEUTRAL = "text-foreground bg-muted";
const CREATED = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

function name(e: AuditEvent): ReactNode {
  const value = e.details.name;
  return (
    <strong className="font-medium">
      «{typeof value === "string" && value ? value : "платёж"}»
    </strong>
  );
}

function money(e: AuditEvent): string | null {
  const raw = e.details.amount;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)} ₽`;
}

function dateRu(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function spec(
  icon: LucideIcon,
  iconClass: string,
  buildHeadline: (e: AuditEvent) => ReactNode,
  withChanges = false,
): AuditEventSpec {
  return {
    icon,
    iconClass,
    buildHeadline,
    buildDetails: withChanges ? (e) => <ChangeLines details={e.details} /> : undefined,
  };
}

export const financeRecurringAuditSpecs: Record<string, AuditEventSpec> = {
  "finance.recurring.created": spec(CalendarPlus, CREATED, (e) => (
    <>создал(а) повторяющийся платёж {name(e)}</>
  )),
  "finance.recurring.updated": spec(
    Pencil,
    INFO,
    (e) => <>изменил(а) повторяющийся платёж {name(e)}</>,
    true,
  ),
  "finance.recurring.paused": spec(Pause, INFO, (e) => (
    <>поставил(а) на паузу повторяющийся платёж {name(e)}</>
  )),
  "finance.recurring.resumed": spec(Play, INFO, (e) => (
    <>возобновил(а) повторяющийся платёж {name(e)}</>
  )),
  "finance.recurring.archived": spec(Archive, NEUTRAL, (e) => (
    <>архивировал(а) повторяющийся платёж {name(e)}</>
  )),
  "finance.recurring.restored": spec(RotateCcw, NEUTRAL, (e) => (
    <>восстановил(а) повторяющийся платёж {name(e)}</>
  )),
  "finance.recurring.deleted": spec(Trash2, DANGER, (e) => (
    <>удалил(а) повторяющийся платёж {name(e)} навсегда</>
  )),

  "finance.recurring_occurrence.posted": spec(CheckCheck, CREATED, (e) => {
    const amount = money(e);
    return (
      <>
        провёл(а) платёж {name(e)}
        {amount && (
          <>
            {" "}на <strong className="font-medium">{amount}</strong>
          </>
        )}
      </>
    );
  }),
  "finance.recurring_occurrence.skipped": spec(SkipForward, NEUTRAL, (e) => {
    const due = dateRu(e.details.due_date);
    return (
      <>
        пропустил(а) платёж {name(e)}
        {due && <> за {due}</>}
      </>
    );
  }),
  "finance.recurring_occurrence.postponed": spec(CalendarClock, INFO, (e) => {
    const to = dateRu(e.details.postponed_to);
    return (
      <>
        перенёс(ла) платёж {name(e)}
        {to && <> на {to}</>}
      </>
    );
  }),
};
