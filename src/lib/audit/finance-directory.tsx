import { BadgeCheck, BadgeX, FilePen, FilePlus, FileX, FolderPen, FolderPlus, FolderX, Trash2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import { ChangeLines } from "./change-lines";
import type { AuditEventSpec } from "./format";

// Справочники «Финансов»: удаление статьи и контрагента (пишет триггер базы,
// миграции 199 и 202), группы статей и контрагентов и документы контрагента
// (пишут server actions через writeAuditEvent).

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

  "finance.counterparty_document.created": spec(FilePlus, CREATED, (e) => (
    <>загрузил(а) документ {name(e, "файл")}</>
  )),
  "finance.counterparty_document.renamed": spec(FilePen, INFO, (e) => {
    const previous = e.details.previous_name;
    return (
      <>
        переименовал(а) документ
        {typeof previous === "string" && previous ? <> «{previous}»</> : null} в {name(e, "файл")}
      </>
    );
  }),
  "finance.counterparty_document.deleted": spec(FileX, DANGER, (e) => (
    <>удалил(а) документ {name(e, "файл")}</>
  )),

  "finance.counterparty_certificate.created": spec(BadgeCheck, CREATED, (e) => (
    <>добавил(а) {name(e, "сертификат")}</>
  )),
  "finance.counterparty_certificate.updated": spec(
    BadgeCheck,
    INFO,
    (e) => <>изменил(а) {name(e, "сертификат")}</>,
    true,
  ),
  "finance.counterparty_certificate.deleted": spec(BadgeX, DANGER, (e) => (
    <>удалил(а) {name(e, "сертификат")}</>
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
