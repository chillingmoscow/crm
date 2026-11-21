import { FolderPen, FolderPlus, FolderX, Trash2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import { ChangeLines } from "./change-lines";
import type { AuditEventSpec } from "./format";

// Справочники «Финансов»: удаление статьи и контрагента (пишет триггер базы,
// миграции 199 и 202) и группы статей и контрагентов (пишут server actions
// через writeAuditEvent).

const INFO = "text-brand bg-brand/10";
const DANGER = "text-destructive bg-destructive/10";
const CREATED = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

function name(e: AuditEvent, fallback: string): ReactNode {
  const value = e.details.name;
  return <strong className="font-medium">«{typeof value === "string" && value ? value : fallback}»</strong>;
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

export const financeDirectoryAuditSpecs: Record<string, AuditEventSpec> = {
  "finance.category.deleted": spec(Trash2, DANGER, (e) => (
    <>удалил(а) статью {name(e, "статья")} навсегда</>
  )),
  "finance.counterparty.deleted": spec(Trash2, DANGER, (e) => (
    <>удалил(а) контрагента {name(e, "контрагент")} навсегда</>
  )),

  "finance.category_group.created": spec(FolderPlus, CREATED, (e) => (
    <>создал(а) группу статей {name(e, "группа")}</>
  )),
  "finance.category_group.updated": spec(
    FolderPen,
    INFO,
    (e) => <>изменил(а) группу статей {name(e, "группа")}</>,
    true,
  ),
  "finance.category_group.deleted": spec(FolderX, DANGER, (e) => (
    <>удалил(а) группу статей {name(e, "группа")}</>
  )),

  "finance.counterparty_group.created": spec(FolderPlus, CREATED, (e) => (
    <>создал(а) группу контрагентов {name(e, "группа")}</>
  )),
  "finance.counterparty_group.updated": spec(
    FolderPen,
    INFO,
    (e) => <>изменил(а) группу контрагентов {name(e, "группа")}</>,
    true,
  ),
  "finance.counterparty_group.deleted": spec(FolderX, DANGER, (e) => (
    <>удалил(а) группу контрагентов {name(e, "группа")}</>
  )),
};
