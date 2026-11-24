import { Banknote, BriefcaseBusiness, Pencil, Trash2, UserMinus } from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import type { AuditEventSpec } from "./format";
import { formatAuditDate as formatDate } from "./labels";

// Официальное трудоустройство (карточка сотрудника): оформление, исправление
// данных, оклад по договору, официальное увольнение, отмена. Пишет команда
// базы payroll_official_command (миграция 383), увольнение в приложении —
// staff_begin_termination (385, details.source = 'termination').

const INFO = "text-brand bg-brand/10";
const CREATED = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
const NEUTRAL = "text-muted-foreground bg-muted";
const DANGER = "text-destructive bg-destructive/10";

function employee(e: AuditEvent): ReactNode {
  return <> · {String(e.details.employee_name ?? "Сотрудник")}</>;
}

function money(value: unknown): string {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function contract(e: AuditEvent): string | null {
  const number = typeof e.details.contract_number === "string" ? e.details.contract_number : null;
  const date = typeof e.details.contract_date === "string" ? e.details.contract_date : null;
  if (!number && !date) return null;
  return ["Договор", number ? `№ ${number}` : null, date ? `от ${formatDate(date)}` : null].filter(Boolean).join(" ");
}

const FIELDS: Record<string, string> = {
  starts_on: "Дата оформления",
  position: "Должность по договору",
  contract_number: "Номер договора",
  contract_date: "Дата договора",
  contract_path: "Трудовой договор",
};

function fieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "starts_on" || field === "contract_date") return formatDate(value);
  if (field === "contract_path") return "файл прикреплён";
  return String(value);
}

function Changes({ e }: { e: AuditEvent }) {
  const changes = Array.isArray(e.details.changes) ? (e.details.changes as Record<string, unknown>[]) : [];
  if (!changes.length) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {changes.map((c, i) => {
        const field = String(c.field);
        return (
          <li key={`${field}-${i}`} className="leading-snug">
            <span className="text-foreground">{FIELDS[field] ?? field}:</span>{" "}
            <span className="line-through">{fieldValue(field, c.old)}</span>
            {" → "}
            <span className="font-medium text-foreground">{fieldValue(field, c.new)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export const payrollOfficialAuditSpecs: Record<string, AuditEventSpec> = {
  "payroll.official_employment.created": {
    icon: BriefcaseBusiness,
    iconClass: CREATED,
    buildHeadline: (e) => <>оформил(а) официально{employee(e)}</>,
    buildDetails: (e) => (
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>
          С {formatDate(e.details.starts_on)} · {String(e.details.position ?? "")} · оклад {money(e.details.gross)}
        </p>
        {contract(e) && <p>{contract(e)}</p>}
      </div>
    ),
  },
  "payroll.official_employment.updated": {
    icon: Pencil,
    iconClass: INFO,
    buildHeadline: (e) => <>исправил(а) данные официального оформления{employee(e)}</>,
    buildDetails: (e) => <Changes e={e} />,
  },
  "payroll.official_salary.created": {
    icon: Banknote,
    iconClass: INFO,
    buildHeadline: (e) => <>изменил(а) оклад по договору{employee(e)}</>,
    buildDetails: (e) => (
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>
          С {formatDate(e.details.valid_from)}:{" "}
          {e.details.previous_gross != null ? `${money(e.details.previous_gross)} → ` : ""}
          {money(e.details.gross)}
        </p>
        {e.details.document_path ? <p>Допсоглашение прикреплено</p> : null}
      </div>
    ),
  },
  "payroll.official_employment.ended": {
    icon: UserMinus,
    iconClass: NEUTRAL,
    buildHeadline: (e) => <>уволил(а) официально{employee(e)}</>,
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        Дата увольнения {formatDate(e.details.ends_on)}
        {e.details.previous_ends_on ? ` (была ${formatDate(e.details.previous_ends_on)})` : ""}
        {e.details.source === "termination" ? " · поставлена при увольнении из заведения" : ""}
      </p>
    ),
  },
  "payroll.official_employment.cancelled": {
    icon: Trash2,
    iconClass: DANGER,
    buildHeadline: (e) => <>отменил(а) официальное оформление{employee(e)}</>,
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        С {formatDate(e.details.starts_on)}
        {e.details.ends_on ? ` по ${formatDate(e.details.ends_on)}` : ""} · {String(e.details.position ?? "")}
      </p>
    ),
  },
};
