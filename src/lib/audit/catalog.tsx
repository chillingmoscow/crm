import Link from "next/link";
import {
  Archive,
  FileText,
  ImagePlus,
  RotateCcw,
  Store,
  Trash2,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { AuditEvent } from "@/lib/audit/list";
import { ChangeLines } from "./change-lines";
import type { AuditEventSpec } from "./format";

// Номенклатура и склады в общем журнале: `catalog.*`, `store.*` и
// `inventory.document_*` (действия над актом целиком, не над позициями).
// События пишут server actions через writeAuditEvent.

const INFO = "text-brand bg-brand/10";
const DANGER = "text-destructive bg-destructive/10";

/** Вид позиции: падежи для фразы и раздел каталога для ссылки. */
const KINDS: Record<string, { gen: string; dat: string; slug: string }> = {
  ingredient: { gen: "ингредиента", dat: "ингредиенту", slug: "ingredients" },
  dish: { gen: "блюда", dat: "блюду", slug: "dishes" },
  semi_finished: {
    gen: "полуфабриката",
    dat: "полуфабрикату",
    slug: "semi-products",
  },
};

function kindOf(e: AuditEvent) {
  return KINDS[String(e.details.kind ?? "")] ?? KINDS.ingredient;
}

/** «Молоко 3,2%» — ссылка на карточку, пока позиция существует и видна. */
function ItemName({ event }: { event: AuditEvent }) {
  const name = String(event.details.name ?? "") || "без названия";
  const entity = event.entity;
  if (entity?.type === "ingredient" && !entity.archived_at) {
    const slug = (KINDS[entity.kind ?? ""] ?? kindOf(event)).slug;
    return (
      <Link
        href={`/catalog/${slug}/${entity.id}`}
        className="font-medium hover:underline"
      >
        «{entity.name || name}»
      </Link>
    );
  }
  return <strong className="font-medium">«{name}»</strong>;
}

function supplier(e: AuditEvent): ReactNode {
  const name = e.details.counterparty_name;
  return (
    <strong className="font-medium">
      «{typeof name === "string" && name ? name : "поставщик"}»
    </strong>
  );
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
    buildDetails: withChanges
      ? (e) => <ChangeLines details={e.details} />
      : undefined,
  };
}

function storeName(e: AuditEvent): ReactNode {
  const title =
    e.entity?.type === "store" ? e.entity.title : String(e.details.title ?? "");
  return <strong className="font-medium">«{title || "склад"}»</strong>;
}

function documentLabel(e: AuditEvent): string {
  const number = e.details.number;
  const date = e.details.date;
  return [
    typeof number === "string" && number ? `№ ${number}` : "без номера",
    typeof date === "string" && date
      ? `от ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export const catalogAuditSpecs: Record<string, AuditEventSpec> = {
  "catalog.ingredient.photo_updated": spec(ImagePlus, INFO, (e) => (
    <>
      {e.details.replaced ? "заменил(а) фото" : "добавил(а) фото"}{" "}
      {kindOf(e).gen} <ItemName event={e} />
    </>
  )),
  "catalog.ingredient_group.photo_updated": spec(ImagePlus, INFO, (e) => (
    <>
      {e.details.replaced ? "заменил(а) фото" : "добавил(а) фото"} группы{" "}
      <strong className="font-medium">
        «{String(e.details.name ?? "") || "без названия"}»
      </strong>
    </>
  )),
  "catalog.ingredient.description_updated": spec(
    FileText,
    INFO,
    (e) => (
      <>
        изменил(а) описание {kindOf(e).gen} <ItemName event={e} />
      </>
    ),
    true,
  ),
  "catalog.ingredient.supplier_added": spec(Truck, INFO, (e) => (
    <>
      добавил(а) поставщика {supplier(e)} {kindOf(e).dat} <ItemName event={e} />
    </>
  )),
  "catalog.ingredient.supplier_updated": spec(
    Truck,
    INFO,
    (e) => (
      <>
        изменил(а) условия поставщика {supplier(e)} для {kindOf(e).gen}{" "}
        <ItemName event={e} />
      </>
    ),
    true,
  ),
  "catalog.ingredient.supplier_removed": spec(Trash2, DANGER, (e) => (
    <>
      убрал(а) поставщика {supplier(e)} у {kindOf(e).gen} <ItemName event={e} />
    </>
  )),
  "store.venue_changed": spec(Store, INFO, (e) =>
    e.details.new_venue_name ? (
      <>
        привязал(а) склад {storeName(e)} к заведению{" "}
        <strong className="font-medium">
          «{String(e.details.new_venue_name)}»
        </strong>
      </>
    ) : (
      <>отвязал(а) склад {storeName(e)} от заведения</>
    ),
  ),
  "store.department_changed": spec(Warehouse, INFO, (e) =>
    e.details.new_scope === "department" ? (
      <>
        привязал(а) склад {storeName(e)} к подразделению{" "}
        <strong className="font-medium">
          «{String(e.details.new_department_name ?? "") || "без названия"}»
        </strong>
      </>
    ) : e.details.new_scope === "shared" ? (
      <>сделал(а) склад {storeName(e)} общим для заведения</>
    ) : (
      <>снял(а) привязку склада {storeName(e)} к подразделению</>
    ),
  ),
  // Архив склада (миграция 365): пишет триггер stores_audit_trigger.
  "store.archived": spec(Archive, "text-muted-foreground bg-muted", (e) => (
    <>отправил(а) в архив склад {storeName(e)}</>
  )),
  "store.restored": spec(RotateCcw, "text-foreground bg-muted", (e) => (
    <>вернул(а) из архива склад {storeName(e)}</>
  )),
  "inventory.document_deleted": spec(Trash2, DANGER, (e) => (
    <>
      удалил(а) акт инвентаризации{" "}
      <strong className="font-medium">{documentLabel(e)}</strong>
      {e.details.store_title ? ` · ${String(e.details.store_title)}` : ""}
    </>
  )),
  "inventory.document_note_updated": spec(
    FileText,
    INFO,
    (e) => (
      <>
        изменил(а) заметку акта инвентаризации{" "}
        {e.entity?.type === "inventory_document" ? (
          <Link
            href={`/documents/inventory/${e.entity.id}`}
            className="font-medium hover:underline"
          >
            {documentLabel(e)}
          </Link>
        ) : (
          <strong className="font-medium">{documentLabel(e)}</strong>
        )}
      </>
    ),
    true,
  ),
};
