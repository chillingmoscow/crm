import { Scale, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import { formatDayMonth } from "@/lib/format/date";
import { formatMoney, formatSignedMoney } from "@/lib/format/amount";
import type { AuditEventSpec } from "./format";

// Сверка остатка счёта с банком (миграция 374). Пишет server action
// через writeAuditEvent; сущность — сам счёт, поэтому события видны в
// «Журнале» карточки счёта.

function accountName(e: AuditEvent): ReactNode {
  const name =
    e.entity && e.entity.type === "bank_account"
      ? e.entity.name
      : typeof e.details.name === "string"
        ? e.details.name
        : "счёт";
  return <strong className="font-medium">«{name}»</strong>;
}

function onDate(e: AuditEvent): string {
  const day = e.details.balance_date;
  return typeof day === "string" ? ` на ${formatDayMonth(day)}` : "";
}

function Lines({ details }: { details: Record<string, unknown> }) {
  const currency = typeof details.currency === "string" ? details.currency : "RUB";
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
  const bank = num(details.bank_balance);
  const calc = num(details.calculated_balance);
  if (!Number.isFinite(bank) || !Number.isFinite(calc)) return null;
  const diff = Math.round((bank - calc) * 100) / 100;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <li className="leading-snug">
        По выписке {formatMoney(bank, currency, 2)}, по операциям {formatMoney(calc, currency, 2)}
      </li>
      <li className="leading-snug">
        {diff === 0 ? "Сходится" : <>Разница {formatSignedMoney(diff, currency, 2)}</>}
      </li>
    </ul>
  );
}

export const bankReconciliationAuditSpecs: Record<string, AuditEventSpec> = {
  "finance.bank_account_reconciliation.created": {
    icon: Scale,
    iconClass: "text-brand bg-brand/10",
    buildHeadline: (e) => (
      <>
        сверил(а) остаток счёта {accountName(e)}
        {onDate(e)}
      </>
    ),
    buildDetails: (e) => <Lines details={e.details} />,
  },
  "finance.bank_account_reconciliation.deleted": {
    icon: Trash2,
    iconClass: "text-destructive bg-destructive/10",
    buildHeadline: (e) => (
      <>
        удалил(а) сверку счёта {accountName(e)}
        {onDate(e)}
      </>
    ),
    buildDetails: (e) => <Lines details={e.details} />,
  },
};
