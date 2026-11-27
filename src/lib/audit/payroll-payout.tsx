import { ArrowRightLeft, Banknote, CalendarCheck, CheckCheck, CircleSlash, ClipboardList, Pencil, ScanSearch, Settings2 } from "lucide-react";

import type { AuditEvent } from "@/lib/audit/list";
import type { AuditEventSpec } from "./format";
import { formatAuditDate as formatDate } from "./labels";

// План выплат зарплаты (миграция 391): формирование и пересчёт черновика,
// правка строки, утверждение и отмена, выдача дня и «Выплачено» переводом,
// настройки графика выплат. Пишут действия из people/payroll/payout-actions.ts.
// Этап 3 (миграция 408): утренняя сверка с изъятием из кассы, автоперенос
// остатка месяца, закрытие карточки «На разбор».

const INFO = "text-brand bg-brand/10";
const CREATED = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
const NEUTRAL = "text-muted-foreground bg-muted";

function money(value: unknown): string {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
function monthName(value: unknown): string {
  const m = /^(\d{4})-(\d{2})/.exec(typeof value === "string" ? value : "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}
const SCHEDULES: Record<string, string> = { main: "основной", cleaner: "клинер", transfer: "переводом" };

function Plan({ e }: { e: AuditEvent }) {
  const schedule = SCHEDULES[String(e.details.schedule ?? "")];
  return (
    <p className="text-xs text-muted-foreground">
      За {monthName(e.details.month)}
      {schedule && <> · график «{schedule}»</>}
      {e.details.total != null && <> · {money(e.details.total)}</>}
      {e.details.rows != null && <> · строк {Number(e.details.rows)}</>}
    </p>
  );
}

function Issue({ e }: { e: AuditEvent }) {
  const lines = Array.isArray(e.details.lines) ? (e.details.lines as { name?: string; amount?: number }[]) : [];
  const moves = Array.isArray(e.details.moves) ? (e.details.moves as { name?: string; to?: string }[]) : [];
  const notMoved = Array.isArray(e.details.not_moved) ? (e.details.not_moved as string[]) : [];
  const transfer = e.details.method === "transfer";
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>
        За {monthName(e.details.month)} · {transfer ? "переводом" : "наличными"} · {money(e.details.total)}
        {e.details.business_date ? <> · {formatDate(e.details.business_date)}</> : null}
      </p>
      {lines.length > 0 && <p>{lines.map((l) => `${l.name ?? "Сотрудник"} ${money(l.amount)}`).join(", ")}</p>}
      {moves.length > 0 && (
        <p>Перенесено на следующую смену: {moves.map((m) => `${m.name ?? "Сотрудник"} → ${m.to ? formatDate(m.to) : "?"}`).join(", ")}</p>
      )}
      {notMoved.length > 0 && <p>Выбрать день вручную: {notMoved.join(", ")}</p>}
      {!transfer && e.details.message_sent != null && (
        <p>{e.details.message_sent ? "Сообщение менеджерам отправлено" : "Сообщение менеджерам не отправлено"}</p>
      )}
    </div>
  );
}

export const payrollPayoutAuditSpecs: Record<string, AuditEventSpec> = {
  "payroll.payout_plan.created": {
    icon: ClipboardList,
    iconClass: CREATED,
    buildHeadline: () => <>сформировал(а) план выплат</>,
    buildDetails: (e) => <Plan e={e} />,
  },
  "payroll.payout_plan.recalculated": {
    icon: ClipboardList,
    iconClass: INFO,
    buildHeadline: () => <>пересчитал(а) план выплат</>,
    buildDetails: (e) => <Plan e={e} />,
  },
  "payroll.payout_plan.approved": {
    icon: CalendarCheck,
    iconClass: CREATED,
    buildHeadline: () => <>утвердил(а) план выплат</>,
    buildDetails: (e) => <Plan e={e} />,
  },
  "payroll.payout_plan.cancelled": {
    icon: CircleSlash,
    iconClass: NEUTRAL,
    buildHeadline: () => <>отменил(а) план выплат</>,
    buildDetails: (e) => <Plan e={e} />,
  },
  "payroll.payout_plan.row_changed": {
    icon: Pencil,
    iconClass: INFO,
    buildHeadline: (e) => <>изменил(а) сумму в плане выплат · {String(e.details.employee_name ?? "Сотрудник")}</>,
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        {money(e.details.previous_amount)} → {money(e.details.amount)}
        {e.details.pay_date !== e.details.previous_pay_date && (
          <> · день {e.details.previous_pay_date ? formatDate(e.details.previous_pay_date) : "не выбран"} → {e.details.pay_date ? formatDate(e.details.pay_date) : "не выбран"}</>
        )}
        {typeof e.details.reason === "string" && <span className="block">{e.details.reason}</span>}
      </p>
    ),
  },
  "payroll.payout_plan.issued": {
    icon: Banknote,
    iconClass: CREATED,
    buildHeadline: (e) => (
      <>
        {e.details.method === "transfer"
          ? "отметил(а) выплату по счёту"
          : e.details.automatic
            ? "выдана зарплата по плану автоматически"
            : "выдал(а) зарплату по плану"}
      </>
    ),
    buildDetails: (e) => <Issue e={e} />,
  },
  "payroll.payout_plan.auto_failed": {
    icon: CircleSlash,
    iconClass: NEUTRAL,
    buildHeadline: () => <>автовыдача по плану не проведена</>,
    buildDetails: (e) => {
      const waiting = Array.isArray(e.details.waiting) ? (e.details.waiting as string[]) : [];
      return (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            {e.details.business_date ? <>{formatDate(e.details.business_date)} · </> : null}
            {String(e.details.reason ?? "")}
          </p>
          {waiting.length > 0 && <p>Ждут выдачи: {waiting.join(", ")}</p>}
        </div>
      );
    },
  },
  "payroll.payout_plan.reconciled": {
    icon: ScanSearch,
    iconClass: INFO,
    buildHeadline: (e) => (
      <>{e.details.state === "matched" ? "выдача сверена с изъятием из кассы" : "выдача не сошлась с изъятием из кассы"}</>
    ),
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        {e.details.business_date ? <>{formatDate(e.details.business_date)} · </> : null}
        проведено {money(e.details.issued)} · изъято {money(e.details.withdrawn)}
      </p>
    ),
  },
  "payroll.payout_plan.carried": {
    icon: ArrowRightLeft,
    iconClass: INFO,
    buildHeadline: () => <>перенесён остаток месяца после второй выплаты</>,
    buildDetails: (e) => {
      const lines = Array.isArray(e.details.lines) ? (e.details.lines as { name?: string; amount?: number }[]) : [];
      return (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>За {monthName(e.details.month)} · {money(e.details.total)}</p>
          {lines.length > 0 && <p>{lines.map((l) => `${l.name ?? "Сотрудник"} ${money(l.amount)}`).join(", ")}</p>}
        </div>
      );
    },
  },
  "payroll.payout_alert.resolved": {
    icon: CheckCheck,
    iconClass: NEUTRAL,
    buildHeadline: () => <>закрыл(а) карточку выплат «Всё верно»</>,
    buildDetails: (e) =>
      typeof e.details.title === "string" ? <p className="text-xs text-muted-foreground">{e.details.title}</p> : null,
  },
  "payroll.payout_settings.updated": {
    icon: Settings2,
    iconClass: INFO,
    buildHeadline: () => <>изменил(а) график выплат</>,
    buildDetails: (e) => (
      <p className="text-xs text-muted-foreground">
        {typeof e.details.auto_issue === "boolean"
          ? (e.details.auto_issue ? "Автовыдача в 14:00 включена" : "Автовыдача в 14:00 выключена")
          : <>Минимум в кэшбоксе {money(e.details.min_cash)}</>}
        {e.details.chat_id !== e.details.previous_chat_id && <> · чат менеджеров изменён</>}
        {Number(e.details.assignments) > 0 && <> · графиков сотрудников изменено: {Number(e.details.assignments)}</>}
      </p>
    ),
  },
};
